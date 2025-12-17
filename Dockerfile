FROM ubuntu:22.04 AS builder
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update
RUN apt-get install -y gcc make g++ patch unzip perl automake tclsh cmake pkg-config && rm -rf /var/lib/apt/lists/*
COPY . /app
WORKDIR /app/srs/trunk
RUN ./configure && make && \
    cp objs/nginx/html/players/js/srs.sdk.js /app/html/players/ && \
    cp objs/nginx/html/favicon.ico /app/html/

FROM ubuntu:22.04
ENV CANDIDATE=127.0.0.1
COPY --from=builder /app/srs/trunk/objs /app/srs/trunk/objs
COPY --from=builder /app/html /app/html
COPY --from=builder /app/rtc.conf /app/rtc.conf
WORKDIR /app/srs/trunk
EXPOSE 1935 1985 1986 8000/udp
CMD ["./objs/srs", "-c", "../../rtc.conf", "-d"]
