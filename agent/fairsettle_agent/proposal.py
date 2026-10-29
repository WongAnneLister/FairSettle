from typing import Protocol

from .clients.models import AgentRunRef, ProposalRequest, ProposalShare, RefundProposal
from .decision import Party
from .evidence import Evidence
from .policy import PolicyVerdict


class ProposalLedger(Protocol):
    async def create_proposal(self, request: ProposalRequest) -> RefundProposal: ...
    async def get_proposal(self, proposal_id: str) -> RefundProposal: ...


PARTY_ORDER: tuple[Party, ...] = ("restaurant", "driver", "platform")


def proposal_request(
    verdict: PolicyVerdict, evidence: Evidence, complaint_id: str, thread_id: str,
) -> ProposalRequest:
    if verdict.outcome != "propose":
        raise ValueError("only a propose verdict can become a proposal")
    decision = verdict.decision
    shares = {share.party: share.basis_points for share in decision.liability}
    return ProposalRequest(
        complaint_id=complaint_id, order_ref=str(evidence.order.id), payment_id=evidence.payment.id,
        decision=decision.decision.upper(), amount_minor=decision.amount_cents,
        currency=evidence.payment.currency, reason_code=decision.reason_code.upper(),
        liability=tuple(ProposalShare(party=party.upper(), basis_points=shares[party]) for party in PARTY_ORDER),
        explanation=decision.explanation, evidence_refs=decision.evidence_refs,
        agent_run=AgentRunRef(thread_id=thread_id),
    )
