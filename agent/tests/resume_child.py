import socket


def refuse_connection(*args, **kwargs):
    raise AssertionError("network access in tests")


socket.socket.connect = refuse_connection

import asyncio
import json
import os
import sys

from resume_factory import FakeProposalLedger, make_input, open_test_agent


async def main():
    mode, database_url, calls_path = sys.argv[1:]
    ledger = FakeProposalLedger()

    def write_calls():
        with open(calls_path, "w") as output:
            json.dump([
                [name, argument.body() if name == "create_proposal" else argument]
                for name, argument in ledger.calls
            ], output)
            output.flush()

    def crash():
        write_calls()
        os._exit(3)

    if mode == "crash":
        ledger.on_create = crash
    async with open_test_agent(database_url, ledger=ledger) as agent:
        status = await agent.start(make_input())
        write_calls()
        print(json.dumps({"status": status.status, "proposal_id": status.proposal_id}))


if __name__ == "__main__":
    asyncio.run(main())
