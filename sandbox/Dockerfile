# Per-session sandbox computer: Ubuntu + Python + Node + headless Chromium + action API.
FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive LANG=C.UTF-8 TZ=UTC \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright PIP_BREAK_SYSTEM_PACKAGES=1
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-pip python3-venv curl wget git ca-certificates sudo unzip zip jq \
      build-essential fonts-noto-cjk fonts-noto-color-emoji poppler-utils pandoc \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*
COPY requirements.txt /opt/sandbox/requirements.txt
RUN pip3 install --no-cache-dir -r /opt/sandbox/requirements.txt \
      pandas numpy matplotlib requests beautifulsoup4 openpyxl python-docx markdown \
    && playwright install --with-deps chromium
# Non-root user with passwordless sudo: full control inside, isolation from the host.
RUN (id ubuntu || useradd -m -s /bin/bash ubuntu) \
    && echo "ubuntu ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/ubuntu \
    && chmod -R a+rx /ms-playwright
COPY server.py /opt/sandbox/server.py
USER ubuntu
WORKDIR /home/ubuntu
ENV SANDBOX_WORKSPACE=/home/ubuntu SANDBOX_PORT=8080
EXPOSE 8080
CMD ["python3", "/opt/sandbox/server.py"]
