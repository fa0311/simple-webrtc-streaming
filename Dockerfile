FROM ossrs/srs:5

ENV CANDIDATE=127.0.0.1

COPY html /usr/local/html

RUN cp /usr/local/srs/objs/nginx/html/players/js/srs.sdk.js /usr/local/html/players/srs.sdk.js && \
    cp /usr/local/srs/objs/nginx/html/favicon.ico /usr/local/html/favicon.ico

COPY rtc.conf /usr/local/srs/conf/rtc.conf

WORKDIR /usr/local/srs

EXPOSE 1935 1985 1986 8000/udp

CMD ["./objs/srs", "-c", "conf/rtc.conf"]
