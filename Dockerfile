FROM ossrs/srs:5

# Set CANDIDATE environment variable for WebRTC
ENV CANDIDATE=127.0.0.1

# Copy custom configuration file
COPY rtc.conf /usr/local/srs/conf/rtc.conf

# Copy custom HTML files
COPY html/index.html /usr/local/srs/objs/nginx/html/
COPY html/players/webrtc.js /usr/local/srs/objs/nginx/html/players/

# Set working directory
WORKDIR /usr/local/srs

# Expose ports
EXPOSE 1935 1985 1986 8000/udp

# Run SRS in foreground mode (no -d flag)
CMD ["./objs/srs", "-c", "conf/rtc.conf"]
