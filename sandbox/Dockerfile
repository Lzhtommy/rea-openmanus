# Per-session sandbox computer: Ubuntu + Python + Node + Chromium on a virtual display (VNC) + action API.
FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive LANG=C.UTF-8 TZ=UTC \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright PIP_BREAK_SYSTEM_PACKAGES=1
# Optional mirrors for slow networks, e.g.
#   --build-arg APT_MIRROR=mirrors.huaweicloud.com
#   --build-arg PIP_INDEX_URL=https://mirrors.huaweicloud.com/repository/pypi/simple
#   --build-arg PLAYWRIGHT_DOWNLOAD_HOST=https://cdn.npmmirror.com/binaries/playwright
ARG APT_MIRROR
ARG PIP_INDEX_URL
ARG PLAYWRIGHT_DOWNLOAD_HOST
RUN echo 'Acquire::Retries "5";' > /etc/apt/apt.conf.d/80-retries \
    && if [ -n "$APT_MIRROR" ]; then \
      sed -i -E "s#//(ports|archive|security)\.ubuntu\.com/#//$APT_MIRROR/#g" /etc/apt/sources.list.d/ubuntu.sources; \
    fi \
    && apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-pip python3-venv curl wget git ca-certificates sudo unzip zip ffmpeg jq \
      build-essential fonts-noto-cjk fonts-noto-color-emoji poppler-utils pandoc xvfb x11vnc \
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
COPY server.py start.sh /opt/sandbox/
USER ubuntu
WORKDIR /home/ubuntu
ENV SANDBOX_WORKSPACE=/home/ubuntu SANDBOX_PORT=8080
EXPOSE 8080
CMD ["/opt/sandbox/start.sh"]
