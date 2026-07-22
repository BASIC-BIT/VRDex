FROM nvidia/cuda:12.8.1-cudnn-runtime-ubuntu24.04@sha256:9175fa92f96de35a8cfb9493f0dfcf9435c7a597e9d95ad41d2cae382a95e3f9

ENV DEBIAN_FRONTEND=noninteractive \
    HF_HOME=/cache/huggingface \
    PYTHONUNBUFFERED=1 \
    TEMPORAL_INFERENCE_HOST=0.0.0.0 \
    TEMPORAL_INFERENCE_PORT=8000

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates python3.12 python3-pip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.lock.txt .
RUN python3.12 -m pip install \
    --break-system-packages \
    --no-cache-dir \
    --require-hashes \
    --extra-index-url https://download.pytorch.org/whl/cu128 \
    -r requirements.lock.txt

COPY server.py temporal_ir_prompts.py ./

RUN useradd --create-home --uid 10001 temporal \
    && mkdir -p /cache/huggingface \
    && chown -R temporal:temporal /app /cache

USER temporal
EXPOSE 8000

CMD ["python3.12", "server.py"]
