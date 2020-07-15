#!/bin/bash
cd /home/container

# Unzip the jar and remove the zip file
unzip PR*.zip
rm PR*.zip

# Run the jar in the background
java -jar Geyser.jar &

# Sleep for 5 seconds to generate config and base locale
sleep 5

# Kill the server 
pkill java

# Make config adjustments
sed -i 's/motd1: "GeyserMC"/motd1: "'"$MOTD"'"/g' config.yml
sed -i 's/motd2: "Another GeyserMC forced host."/motd2: "'"$MOTD"'"/g' config.yml
sed -i 's/127.0.0.1/172.17.0.1/g' config.yml # remote address
sed -i 's/: online/: floodgate/g' config.yml # auth-type
sed -i 's/command-suggestions: true/command-suggestions: false/g' config.yml
sed -i 's/100/10/g' config.yml # max-players
sed -i 's/cache-chunks: false/cache-chunks: true/g' config.yml

# Start Geyser
java -jar Geyser.jar &

# Sleep 24h
sleep 24h

# Kill the server
pkill java
