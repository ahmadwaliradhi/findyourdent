# syntax=docker/dockerfile:1
# Agent service image. Build from the repository root:
#   docker build -f services/agent/Dockerfile -t findyourdent-agent .
# Runs on $PORT (Cloud Run sets it; default 8080) as a non-root user.

FROM ghcr.io/astral-sh/uv:0.13.1 AS uv

FROM python:3.13-slim AS build
COPY --from=uv /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/app/.venv
WORKDIR /app
COPY services/agent/pyproject.toml services/agent/uv.lock services/agent/.python-version ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-dev --no-install-project
COPY services/agent/src ./src
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-dev --no-editable

FROM python:3.13-slim AS runtime
RUN useradd --system --uid 10001 --user-group --no-create-home agent
COPY --from=build /app/.venv /app/.venv
COPY packages/contracts/schemas /app/contracts/schemas
COPY packages/contracts/data /app/contracts/data
ENV PATH="/app/.venv/bin:${PATH}" \
    CONTRACTS_DIR=/app/contracts \
    PYTHONUNBUFFERED=1 \
    PORT=8080
USER agent
EXPOSE 8080
CMD ["agent-serve"]
