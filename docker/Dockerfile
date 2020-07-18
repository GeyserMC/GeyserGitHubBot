# This is the docker file for the test server instances
# Based on the standard one 
FROM openjdk:8-jre-slim

LABEL author="GeyserMC Team" maintainer="support@geysermc.org"

RUN apt-get update -y \
 && apt-get install -y unzip ca-certificates openssl tzdata procps \
 && useradd -d /home/container -m container
 
USER container
ENV  USER=container HOME=/home/container

WORKDIR /home/container

COPY ./setup.sh /setup.sh

CMD ["/bin/bash", "/setup.sh"]