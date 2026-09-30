FROM python:3.12-slim@sha256:f77ac9e44ae96ef2c90b8053ea08c31f8be030f824196b0ae4db6d462c84e51f
ARG VCS_REF=development
LABEL org.opencontainers.image.revision=$VCS_REF
WORKDIR /worker
COPY scripts/background-removal-requirements.txt requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY services/background-removal/worker.py worker.py
COPY scripts/background-removal-notices.txt /worker/LICENSE-rembg.txt
ENV PYTHONDONTWRITEBYTECODE=1 OMP_NUM_THREADS=3
USER 1000:1000
HEALTHCHECK --interval=20s --timeout=4s --start-period=30s --retries=3 CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8090/health',timeout=3)"
CMD ["python", "worker.py"]
