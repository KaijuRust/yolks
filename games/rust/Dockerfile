#
# Copyright (c) 2021 Pterodactyl
#
# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:
#
# The above copyright notice and this permission notice shall be included in all
# copies or substantial portions of the Software.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
# SOFTWARE.
#

ARG         NODE_VERSION=current

FROM        --platform=$TARGETOS/$TARGETARCH node:${NODE_VERSION}-bookworm-slim

LABEL       author="JackoPlane" maintainer="JackoPlane"

LABEL       org.opencontainers.image.source https://github.com/KaijuRust/yolks
LABEL       org.opencontainers.image.licenses MIT

ENV         DEBIAN_FRONTEND=noninteractive
ENV         NODE_ENV=production

# Install Dependancies
RUN         dpkg --add-architecture i386 \
            && apt update \
            && apt upgrade -y \
            && apt install -y lib32gcc-s1 lib32stdc++6 unzip curl iproute2 tzdata libgdiplus libsdl2-2.0-0:i386 jq

# Download dependencies as a separate step to take advantage of Docker's caching.
# Leverage a cache mount to /root/.npm to speed up subsequent builds.
# Leverage a bind mounts to package.json and package-lock.json to avoid having to copy them into
# into this layer.
RUN         --mount=type=bind,source=package.json,target=package.json \
            --mount=type=bind,source=package-lock.json,target=package-lock.json \
            --mount=type=cache,target=/root/.npm \
            npm ci --omit=dev

# Define user environment
RUN 			useradd -d /home/container -m container
USER        	container
ENV         	USER=container HOME=/home/container

WORKDIR     /home/container

# Run the application as a non-root user.
# USER node

# Copy the rest of the source files into the image.
COPY        . .
COPY        ./wrapper.js /wrapper.js
COPY        ./entrypoint.sh /entrypoint.sh

COPY        --chmod=0755 ./helpers /helpers

# Run the application.
CMD         [ "/bin/bash", "/entrypoint.sh" ]
