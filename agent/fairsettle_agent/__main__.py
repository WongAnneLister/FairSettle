import os
os.environ.setdefault("LITELLM_LOCAL_MODEL_COST_MAP", "True")

import logging

import uvicorn

from .agent import AgentConfig, open_agent
from .service import ServiceConfig, create_app


def main(env=os.environ, run=uvicorn.run):
    config = AgentConfig.from_env(env)
    service = ServiceConfig.from_env(env)
    logging.basicConfig(level=logging.INFO)
    run(create_app(lambda: open_agent(config), poll_seconds=service.poll_seconds),
        host=service.host, port=8000, log_level="info")


if __name__ == "__main__":
    main()
