# Geyser PR Testing using Docker
This contains the docker image used when launching PR test servers

## Setup
1. Download a Geyser Standalone build to a zip following the format `PR#*.zip`
2. Build the docker file using `docker build -t geyser-test .`
3. Start Geyser using this:
```
docker run --name "geyser-pr-100" -d -p 19132/udp -v $(pwd)/pr/100/:/home/container geyser-test
```