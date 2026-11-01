from dataclasses import dataclass
from datetime import datetime, timedelta

from psycopg_pool import AsyncConnectionPool


@dataclass(frozen=True)
class ComplaintRow:
    complaint_id: str
    order_id: int
    customer_id: int | None
    received_at: datetime
    status: str
    proposal_id: str | None
    submit_attempts: int


_COLUMNS = "complaint_id, order_id, customer_id, received_at, status, proposal_id, submit_attempts"


class ComplaintStore:
    def __init__(self, pool: AsyncConnectionPool) -> None:
        self.pool = pool

    async def setup(self) -> None:
        async with self.pool.connection() as conn:
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS agent_complaint (
                    complaint_id text PRIMARY KEY,
                    order_id bigint NOT NULL,
                    customer_id bigint,
                    received_at timestamptz NOT NULL,
                    status text NOT NULL CHECK (status IN (
                        'running', 'submitting', 'submit_retry', 'awaiting_review',
                        'approved', 'rejected', 'declined', 'escalated', 'refunded', 'refund_failed')),
                    proposal_id text,
                    submit_attempts integer NOT NULL DEFAULT 0 CHECK (submit_attempts >= 0),
                    updated_at timestamptz NOT NULL
                )
            """)
            async with conn.transaction():
                await conn.execute("ALTER TABLE agent_complaint DROP CONSTRAINT IF EXISTS agent_complaint_status_check")
                await conn.execute("""
                    ALTER TABLE agent_complaint ADD CONSTRAINT agent_complaint_status_check CHECK (status IN (
                        'running', 'submitting', 'submit_retry', 'awaiting_review', 'approved',
                        'rejected', 'declined', 'escalated', 'refunded', 'refund_failed'))
                """)
            await conn.execute("CREATE INDEX IF NOT EXISTS agent_complaint_customer ON agent_complaint (customer_id, received_at)")
            await conn.execute("CREATE INDEX IF NOT EXISTS agent_complaint_status ON agent_complaint (status)")
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS agent_trigger_cursor (
                    name text PRIMARY KEY,
                    last_event_id bigint NOT NULL CHECK (last_event_id >= 0),
                    updated_at timestamptz NOT NULL
                )
            """)

    async def get_cursor(self, name: str) -> int:
        async with self.pool.connection() as conn:
            cursor = await conn.execute("SELECT last_event_id FROM agent_trigger_cursor WHERE name = %s", (name,))
            row = await cursor.fetchone()
            return 0 if row is None else row["last_event_id"]

    async def set_cursor(self, name: str, event_id: int) -> None:
        if type(event_id) is not int or event_id < 0:
            raise ValueError("event_id must be an integer of at least 0")
        async with self.pool.connection() as conn:
            await conn.execute("""
                INSERT INTO agent_trigger_cursor (name, last_event_id, updated_at) VALUES (%s, %s, now())
                ON CONFLICT (name) DO UPDATE SET
                    last_event_id = GREATEST(agent_trigger_cursor.last_event_id, EXCLUDED.last_event_id),
                    updated_at = now()
            """, (name, event_id))

    @staticmethod
    def _aware(received_at: datetime) -> None:
        if received_at.tzinfo is None or received_at.utcoffset() is None:
            raise ValueError("received_at must be timezone-aware")

    async def register(self, complaint_id: str, order_id: int, received_at: datetime) -> bool:
        self._aware(received_at)
        async with self.pool.connection() as conn:
            cursor = await conn.execute("""
                INSERT INTO agent_complaint (complaint_id, order_id, received_at, status, submit_attempts, updated_at)
                VALUES (%s, %s, %s, 'running', 0, now())
                ON CONFLICT (complaint_id) DO NOTHING
            """, (complaint_id, order_id, received_at))
            return cursor.rowcount == 1

    async def _update(self, query: str, parameters: tuple, complaint_id: str):
        async with self.pool.connection() as conn:
            cursor = await conn.execute(query, parameters)
            if cursor.rowcount == 0:
                raise LookupError(complaint_id)
            return await cursor.fetchone() if cursor.description is not None else None

    async def record_customer(self, complaint_id: str, customer_id: int) -> None:
        await self._update(
            "UPDATE agent_complaint SET customer_id = %s, updated_at = now() WHERE complaint_id = %s",
            (customer_id, complaint_id), complaint_id,
        )

    # Keep the SQL prefix in sync with PROACTIVE_PREFIX in proactive.py.
    async def count_prior(self, customer_id: int, complaint_id: str, received_at: datetime) -> int:
        self._aware(received_at)
        async with self.pool.connection() as conn:
            cursor = await conn.execute("""
                SELECT count(*) AS n FROM agent_complaint
                WHERE customer_id = %s AND complaint_id <> %s AND received_at >= %s AND received_at < %s
                    AND complaint_id NOT LIKE 'delivery-failed-%%'
            """, (customer_id, complaint_id, received_at - timedelta(days=7), received_at))
            return (await cursor.fetchone())["n"]

    async def history(self, customer_id: int, complaint_id: str, received_at: datetime,
                      *, days: int, limit: int) -> list[ComplaintRow]:
        self._aware(received_at)
        async with self.pool.connection() as conn:
            cursor = await conn.execute(f"""
                SELECT {_COLUMNS} FROM agent_complaint
                WHERE customer_id = %s AND complaint_id <> %s AND received_at >= %s AND received_at < %s
                ORDER BY received_at DESC, complaint_id LIMIT %s
            """, (customer_id, complaint_id, received_at - timedelta(days=days), received_at, limit))
            return [ComplaintRow(**row) for row in await cursor.fetchall()]

    async def begin_submit(self, complaint_id: str) -> int:
        row = await self._update("""
            UPDATE agent_complaint SET status = 'submitting', submit_attempts = submit_attempts + 1,
                updated_at = now() WHERE complaint_id = %s RETURNING submit_attempts
        """, (complaint_id,), complaint_id)
        return row["submit_attempts"]

    async def set_status(self, complaint_id: str, status: str) -> None:
        await self._update(
            "UPDATE agent_complaint SET status = %s, updated_at = now() WHERE complaint_id = %s",
            (status, complaint_id), complaint_id,
        )

    async def mark_awaiting(self, complaint_id: str, proposal_id: str) -> None:
        await self._update("""
            UPDATE agent_complaint SET status = 'awaiting_review', proposal_id = %s, updated_at = now()
            WHERE complaint_id = %s
        """, (proposal_id, complaint_id), complaint_id)

    async def finish(self, complaint_id: str, status: str) -> None:
        await self.set_status(complaint_id, status)

    async def mark_approved(self, complaint_id: str) -> None:
        await self.set_status(complaint_id, "approved")

    async def get(self, complaint_id: str) -> ComplaintRow | None:
        async with self.pool.connection() as conn:
            cursor = await conn.execute(
                "SELECT " + _COLUMNS + " FROM agent_complaint WHERE complaint_id = %s", (complaint_id,),
            )
            row = await cursor.fetchone()
            return None if row is None else ComplaintRow(**row)

    async def resumable(self) -> list[ComplaintRow]:
        async with self.pool.connection() as conn:
            cursor = await conn.execute(
                "SELECT " + _COLUMNS + " FROM agent_complaint "
                "WHERE status IN ('submitting', 'submit_retry', 'awaiting_review', 'approved') ORDER BY received_at, complaint_id",
            )
            return [ComplaintRow(**row) for row in await cursor.fetchall()]

    async def running(self) -> list[str]:
        async with self.pool.connection() as conn:
            cursor = await conn.execute(
                "SELECT complaint_id FROM agent_complaint WHERE status = 'running' ORDER BY received_at, complaint_id",
            )
            return [row["complaint_id"] for row in await cursor.fetchall()]
