FROM ossrs/srs:6
ENV CANDIDATE=127.0.0.1
WORKDIR /usr/local/srs

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY html ../../html
RUN cp objs/nginx/html/players/js/srs.sdk.js ../../html/players/srs.sdk.js && \
    cp objs/nginx/html/favicon.ico ../../html/favicon.ico
COPY rtc.conf conf/rtc.conf

HEALTHCHECK --interval=1m --timeout=5s --start-period=20s --retries=1 CMD curl -S http://localhost:1935

EXPOSE 1935 1985 1986 8000/udp
CMD ["./objs/srs", "-c", "conf/rtc.conf"]
