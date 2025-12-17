FROM ossrs/srs:5

ENV CANDIDATE=127.0.0.1

WORKDIR /usr/local/srs

COPY html ../../html

RUN cp objs/nginx/html/players/js/srs.sdk.js ../../html/players/srs.sdk.js && \
    cp objs/nginx/html/favicon.ico ../../html/favicon.ico

COPY rtc.conf conf/rtc.conf

EXPOSE 1935 1985 1986 8000/udp

CMD ["./objs/srs", "-c", "conf/rtc.conf"]
