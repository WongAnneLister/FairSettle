FROM python:3.11.15-slim-bookworm
COPY --from=astral/uv:0.12.23 /uv /bin/uv
ENV UV_PROJECT_ENVIRONMENT=/app/.venv UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never \
    LITELLM_LOCAL_MODEL_COST_MAP=True PYTHONUNBUFFERED=1
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --python /usr/local/bin/python3.11
COPY fairsettle_agent fairsettle_agent
RUN useradd --system --uid 10001 agent
USER agent
EXPOSE 8000
CMD ["/app/.venv/bin/python", "-m", "fairsettle_agent"]
