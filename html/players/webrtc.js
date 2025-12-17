// WebRTCPlayer.js
"use strict";

// Constants
const ZOOM_MIN = 1;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.25;
const DEBUG_UPDATE_INTERVAL = 1000;
const RECONNECT_DELAY = 3000;
const MAX_RECONNECT_ATTEMPTS = 5;
const STATS_HISTORY_SIZE = 60;

const params = new URLSearchParams(location.search);
const app = params.get("app") || "live";
const stream = params.get("stream") || "livestream";
const WEBRTC_URL = `webrtc://${location.hostname}/${app}/${stream}`;

// RTC Configuration with STUN servers
const RTC_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
  iceCandidatePoolSize: 10,
  bundlePolicy: "max-bundle",
  rtcpMuxPolicy: "require",
  sdpSemantics: "unified-plan",
};

// Class for managing the WebRTC player
class WebRTCPlayer {
  constructor() {
    this.elements = this.getElements();
    this.state = this.initializeState();
    this.sdk = null;
    this.debugInterval = null;
    this.performanceInterval = null;
    this.statsHistory = {
      fps: [],
      bitrate: [],
      packetLoss: [],
      jitter: [],
      rtt: [],
      framesDecoded: [],
      framesDropped: [],
      keyFrameInterval: [],
      videoFrameCallbackFps: [],
    };
    this.lastStats = {
      video: {},
      audio: {},
    };
    this.activeDebugTab = "stats";
    this.statsStartTime = Date.now();
    this.sdpInfo = {
      local: null,
      remote: null,
    };
    this.performanceMetrics = {
      frameCount: 0,
      lastFrameTime: 0,
      fps: 0,
      keyFrameTimestamps: [],
      lastKeyFrameTime: 0,
      fpsHistory: [],
      maxFpsAchieved: 0,
      videoFrameCallbackFps: 0,
      lastPresentedFrames: 0,
      lastVideoFrameTime: 0,
    };

    this.init();
  }

  getElements() {
    return {
      video: document.getElementById("video"),
      playPauseBtn: document.getElementById("play-pause"),
      volumeBtn: document.getElementById("volume-btn"),
      volumeSlider: document.getElementById("volume-slider"),
      zoomInBtn: document.getElementById("zoom-in"),
      zoomOutBtn: document.getElementById("zoom-out"),
      zoomLabel: document.getElementById("zoom-label"),
      screenshotBtn: document.getElementById("screenshot"),
      fullscreenBtn: document.getElementById("fullscreen"),
      debugBtn: document.getElementById("debug-btn"),
      debugPanel: document.getElementById("debug-panel"),
      debugContent: document.getElementById("debug-content"),
      debugClose: document.querySelector(".debug-close"),
      debugTabs: document.querySelectorAll(".debug-tab"),
      errorBox: document.getElementById("error"),
      loading: document.getElementById("loading"),
      connectionStatus: document.getElementById("connection-status"),
      statusIndicator: document.querySelector(".status-indicator"),
      statusText: document.querySelector(".status-text"),
      container: document.getElementById("player-container"),
      toolbar: document.getElementById("toolbar"),
    };
  }

  initializeState() {
    return {
      zoom: {
        scale: 1,
        translateX: 0,
        translateY: 0,
      },
      dragging: false,
      dragStart: { x: 0, y: 0 },
      dragOffset: { x: 0, y: 0 },
      isPlaying: false,
      reconnectAttempts: 0,
      connectionQuality: "connecting",
      totalFramesDecoded: 0,
      totalFramesDropped: 0,
      streamStartTime: null,
      actualFpsSum: 0,
      actualFpsCount: 0,
      lastKeyFrameCount: 0,
      codecType: null,
    };
  }

  init() {
    this.checkDependencies();
    this.setupEventListeners();
    this.setupKeyboardShortcuts();
    this.loadPlayerSettings();
    this.startPlaying();
  }

  checkDependencies() {
    if (typeof SrsRtcPlayerAsync === "undefined") {
      this.showError(
        "SRS SDK not loaded. Please check your internet connection."
      );
      throw new Error("SrsRtcPlayerAsync is not defined");
    }
  }

  setupEventListeners() {
    // Playback controls
    this.elements.playPauseBtn.addEventListener("click", () =>
      this.togglePlayPause()
    );

    // Volume controls
    this.elements.volumeBtn.addEventListener("click", () => this.toggleMute());
    this.elements.volumeSlider.addEventListener("input", (e) =>
      this.setVolume(e.target.value)
    );

    // Zoom controls
    this.elements.zoomInBtn.addEventListener("click", () =>
      this.zoom(ZOOM_STEP)
    );
    this.elements.zoomOutBtn.addEventListener("click", () =>
      this.zoom(-ZOOM_STEP)
    );
    this.elements.video.addEventListener("dblclick", () => this.toggleZoom());

    // Pan controls
    this.setupPanControls();

    // Other controls
    this.elements.screenshotBtn.addEventListener("click", () =>
      this.takeScreenshot()
    );
    this.elements.fullscreenBtn.addEventListener("click", () =>
      this.toggleFullscreen()
    );
    this.elements.debugBtn.addEventListener("click", () =>
      this.toggleDebugPanel()
    );
    this.elements.debugClose.addEventListener("click", () =>
      this.toggleDebugPanel()
    );

    // Debug tabs
    this.elements.debugTabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        this.activeDebugTab = tab.dataset.tab;
        this.elements.debugTabs.forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");
        this.updateDebugInfo();
      });
    });

    // Video events
    this.elements.video.addEventListener("loadedmetadata", () =>
      this.onVideoLoaded()
    );
    this.elements.video.addEventListener("play", () =>
      this.updatePlayPauseIcon(true)
    );
    this.elements.video.addEventListener("pause", () =>
      this.updatePlayPauseIcon(false)
    );

    // Fullscreen change
    document.addEventListener("fullscreenchange", () =>
      this.onFullscreenChange()
    );
  }

  setupKeyboardShortcuts() {
    document.addEventListener("keydown", (e) => {
      // Prevent shortcuts when typing
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")
        return;

      switch (e.key.toLowerCase()) {
        case " ":
          e.preventDefault();
          this.togglePlayPause();
          break;
        case "f":
          this.toggleFullscreen();
          break;
        case "m":
          this.toggleMute();
          break;
        case "d":
          this.toggleDebugPanel();
          break;
        case "s":
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            this.takeScreenshot();
          }
          break;
        case "+":
        case "=":
          this.zoom(ZOOM_STEP);
          break;
        case "-":
          this.zoom(-ZOOM_STEP);
          break;
        case "0":
          this.resetZoom();
          break;
        case "arrowup":
          e.preventDefault();
          this.adjustVolume(5);
          break;
        case "arrowdown":
          e.preventDefault();
          this.adjustVolume(-5);
          break;
      }
    });
  }

  setupPanControls() {
    let isPanning = false;
    let startX = 0;
    let startY = 0;

    const handlePointerDown = (e) => {
      if (this.state.zoom.scale === 1) return;
      isPanning = true;
      startX = e.clientX - this.state.zoom.translateX;
      startY = e.clientY - this.state.zoom.translateY;
      this.elements.video.style.cursor = "grabbing";
      this.elements.video.setPointerCapture(e.pointerId);
    };

    const handlePointerMove = (e) => {
      if (!isPanning) return;
      this.state.zoom.translateX = e.clientX - startX;
      this.state.zoom.translateY = e.clientY - startY;
      this.clampPan();
      this.applyTransform();
    };

    const handlePointerUp = (e) => {
      isPanning = false;
      this.elements.video.style.cursor = "";
      try {
        this.elements.video.releasePointerCapture(e.pointerId);
      } catch {}
    };

    this.elements.video.addEventListener("pointerdown", handlePointerDown);
    this.elements.video.addEventListener("pointermove", handlePointerMove);
    this.elements.video.addEventListener("pointerup", handlePointerUp);
    this.elements.video.addEventListener("pointercancel", handlePointerUp);
  }

  async startPlaying() {
    this.showLoading(true);
    this.updateConnectionStatus("connecting", "Connecting...");

    try {
      // Create SDK instance with optimized RTC config
      this.sdk = new SrsRtcPlayerAsync();

      // Override the default RTC configuration
      if (this.sdk.pc) {
        this.sdk.pc.close();
      }
      this.sdk.pc = new RTCPeerConnection(RTC_CONFIG);

      // Re-setup ontrack handler
      this.sdk.pc.ontrack = (event) => {
        console.log("Track received:", {
          kind: event.track.kind,
          id: event.track.id,
          readyState: event.track.readyState,
        });
        if (this.sdk.ontrack) {
          this.sdk.ontrack(event);
        }

        // For video tracks, monitor frame rate
        if (event.track.kind === "video") {
          this.monitorVideoTrack(event.track);
        }
      };

      // Store local and remote SDP for debugging
      const originalSetLocalDescription = this.sdk.pc.setLocalDescription.bind(
        this.sdk.pc
      );
      this.sdk.pc.setLocalDescription = async (desc) => {
        this.sdpInfo.local = desc.sdp;
        console.log("Local SDP:", desc.sdp);
        return originalSetLocalDescription(desc);
      };

      const originalSetRemoteDescription =
        this.sdk.pc.setRemoteDescription.bind(this.sdk.pc);
      this.sdk.pc.setRemoteDescription = async (desc) => {
        this.sdpInfo.remote = desc.sdp;

        // Log video parameters
        const videoParams = this.extractVideoParams(desc.sdp);
        console.log("Video params from SDP:", videoParams);

        // Detect codec type
        if (videoParams.codec) {
          if (
            videoParams.codec.toLowerCase().includes("h265") ||
            videoParams.codec.toLowerCase().includes("hevc")
          ) {
            this.state.codecType = "H265/HEVC";
          } else if (
            videoParams.codec.toLowerCase().includes("h264") ||
            videoParams.codec.toLowerCase().includes("avc")
          ) {
            this.state.codecType = "H264/AVC";
          } else if (videoParams.codec.toLowerCase().includes("vp8")) {
            this.state.codecType = "VP8";
          } else if (videoParams.codec.toLowerCase().includes("vp9")) {
            this.state.codecType = "VP9";
          } else if (videoParams.codec.toLowerCase().includes("av1")) {
            this.state.codecType = "AV1";
          } else {
            this.state.codecType = videoParams.codec;
          }
        } else if (videoParams.h265ProfileId !== undefined) {
          // H265 detected from profile-id
          this.state.codecType = "H265/HEVC";
        }

        return originalSetRemoteDescription(desc);
      };

      this.elements.video.srcObject = this.sdk.stream;

      // Set up connection monitoring
      this.monitorConnection();

      // Play with URL
      await this.sdk.play(WEBRTC_URL);

      this.showLoading(false);
      this.updateConnectionStatus("good", "Connected");
      this.state.isPlaying = true;
      this.state.reconnectAttempts = 0;
      this.state.streamStartTime = Date.now();

      // Show toolbar briefly
      this.elements.toolbar.classList.add("force-show");
      setTimeout(() => {
        this.elements.toolbar.classList.remove("force-show");
      }, 3000);

      // Log codec information
      this.logCodecInfo();
    } catch (error) {
      this.handlePlaybackError(error);
    }
  }

  extractVideoParams(sdp) {
    const params = {};

    // Extract framerate from a=framerate line
    const framerateMatch = sdp.match(/a=framerate:(\d+)/);
    if (framerateMatch) {
      params.framerate = parseInt(framerateMatch[1]);
    }

    // Extract from fmtp line
    const fmtpMatch = sdp.match(/a=fmtp:\d+.*max-fr=(\d+)/);
    if (fmtpMatch) {
      params.maxFramerate = parseInt(fmtpMatch[1]);
    }

    // Extract video codec
    const codecMatch = sdp.match(/m=video.*\r?\n.*\r?\na=rtpmap:(\d+)\s+(\S+)/);
    if (codecMatch) {
      params.codec = codecMatch[2];
    }

    // Extract profile-level-id for H264/H265
    const profileMatch = sdp.match(/profile-level-id=([0-9a-f]+)/i);
    if (profileMatch) {
      params.profileLevelId = profileMatch[1];
    }

    // Extract profile-id for H265
    const h265ProfileMatch = sdp.match(/profile-id=(\d+)/);
    if (h265ProfileMatch) {
      params.h265ProfileId = parseInt(h265ProfileMatch[1]);
    }

    // Extract level-id for H265
    const levelMatch = sdp.match(/level-id=(\d+)/);
    if (levelMatch) {
      params.levelId = parseInt(levelMatch[1]);
    }

    // Extract tier-flag for H265
    const tierMatch = sdp.match(/tier-flag=(\d+)/);
    if (tierMatch) {
      params.tierFlag = parseInt(tierMatch[1]);
    }

    // Extract tx-mode for H265
    const txModeMatch = sdp.match(/tx-mode=(\w+)/);
    if (txModeMatch) {
      params.txMode = txModeMatch[1];
    }

    return params;
  }

  monitorVideoTrack(track) {
    // Monitor using requestVideoFrameCallback if available
    if ("requestVideoFrameCallback" in HTMLVideoElement.prototype) {
      let frameCount = 0;
      let lastTime = performance.now();
      let lastPresentedFrames = 0;

      const onFrame = (now, metadata) => {
        const frameDelta = metadata.presentedFrames - lastPresentedFrames;
        frameCount += frameDelta;

        const elapsed = now - lastTime;
        if (elapsed >= 1000) {
          const fps = (frameCount * 1000) / elapsed;
          this.performanceMetrics.videoFrameCallbackFps = fps;

          // console.log(`Video frame callback FPS: ${fps.toFixed(1)}, presented frames: ${metadata.presentedFrames}, width: ${metadata.width}, height: ${metadata.height}`);

          // Track max FPS
          if (fps > this.performanceMetrics.maxFpsAchieved) {
            this.performanceMetrics.maxFpsAchieved = fps;
          }

          frameCount = 0;
          lastTime = now;
        }

        lastPresentedFrames = metadata.presentedFrames;
        this.performanceMetrics.lastPresentedFrames = metadata.presentedFrames;

        if (this.state.isPlaying) {
          this.elements.video.requestVideoFrameCallback(onFrame);
        }
      };

      this.elements.video.requestVideoFrameCallback(onFrame);
    }
  }

  async logCodecInfo() {
    if (!this.sdk || !this.sdk.pc) return;

    setTimeout(async () => {
      const stats = await this.sdk.pc.getStats();
      const codecs = { video: [], audio: [] };

      stats.forEach((stat) => {
        if (stat.type === "codec") {
          if (stat.mimeType?.includes("video")) {
            codecs.video.push({
              mimeType: stat.mimeType,
              clockRate: stat.clockRate,
              payloadType: stat.payloadType,
              sdpFmtpLine: stat.sdpFmtpLine,
              implementation: stat.implementation,
            });
          } else if (stat.mimeType?.includes("audio")) {
            codecs.audio.push({
              mimeType: stat.mimeType,
              clockRate: stat.clockRate,
              payloadType: stat.payloadType,
              channels: stat.channels,
            });
          }
        }
      });

      console.log("Negotiated codecs:", codecs);
    }, 2000);
  }

  monitorConnection() {
    if (!this.sdk || !this.sdk.pc) return;

    this.sdk.pc.addEventListener("connectionstatechange", () => {
      const state = this.sdk.pc.connectionState;
      console.log("Connection state changed:", state);

      switch (state) {
        case "connected":
          this.updateConnectionStatus("good", "Connected");
          break;
        case "connecting":
          this.updateConnectionStatus("connecting", "Connecting...");
          break;
        case "disconnected":
          this.updateConnectionStatus("bad", "Disconnected");
          this.attemptReconnect();
          break;
        case "failed":
          this.updateConnectionStatus("bad", "Connection Failed");
          this.attemptReconnect();
          break;
      }
    });
  }

  async attemptReconnect() {
    if (this.state.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.showError("Connection lost. Please refresh the page.");
      return;
    }

    this.state.reconnectAttempts++;
    this.updateConnectionStatus(
      "connecting",
      `Reconnecting... (${this.state.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`
    );

    setTimeout(() => {
      this.startPlaying();
    }, RECONNECT_DELAY);
  }

  handlePlaybackError(error) {
    console.error("Playback error:", error);
    this.showLoading(false);
    this.updateConnectionStatus("bad", "Error");

    let errorMessage = "Failed to start playback. ";

    if (error.message.includes("Permission")) {
      errorMessage += "Please allow camera/microphone access.";
    } else if (error.message.includes("NotFound")) {
      errorMessage += "Stream not found.";
    } else if (error.message.includes("Network")) {
      errorMessage += "Network error. Please check your connection.";
    } else {
      errorMessage += error.message || "Unknown error.";
    }

    this.showError(errorMessage);
  }

  // UI Update Methods
  showLoading(show) {
    this.elements.loading.classList.toggle("show", show);
  }

  showError(message) {
    this.elements.errorBox.textContent = message;
    this.elements.errorBox.classList.add("show");

    setTimeout(() => {
      this.elements.errorBox.classList.remove("show");
    }, 5000);
  }

  updateConnectionStatus(quality, text) {
    this.state.connectionQuality = quality;
    this.elements.statusIndicator.className = `status-indicator ${quality}`;
    this.elements.statusText.textContent = text;
    this.elements.connectionStatus.classList.add("show");

    if (quality === "good") {
      setTimeout(() => {
        this.elements.connectionStatus.classList.remove("show");
      }, 3000);
    }
  }

  // Playback Controls
  togglePlayPause() {
    if (this.elements.video.paused) {
      this.elements.video.play();
    } else {
      this.elements.video.pause();
    }
  }

  updatePlayPauseIcon(isPlaying) {
    const icon = isPlaying
      ? '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>'
      : '<path d="M8 5v14l11-7z"/>';
    this.elements.playPauseBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">${icon}</svg>`;
  }

  // Volume Controls
  toggleMute() {
    this.elements.video.muted = !this.elements.video.muted;
    this.updateVolumeIcon();
  }

  setVolume(value) {
    this.elements.video.volume = value / 100;
    this.updateVolumeIcon();
    this.savePlayerSettings();
  }

  adjustVolume(delta) {
    const newValue = Math.max(
      0,
      Math.min(100, parseInt(this.elements.volumeSlider.value) + delta)
    );
    this.elements.volumeSlider.value = newValue;
    this.setVolume(newValue);
  }

  updateVolumeIcon() {
    const volume = this.elements.video.volume;
    const muted = this.elements.video.muted;
    let icon;

    if (muted || volume === 0) {
      icon =
        '<path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-18-18zM12 4L9.91 6.09 12 8.18V4z"/>';
    } else if (volume < 0.5) {
      icon = '<path d="M7 9v6h4l5 5V4l-5 5H7z"/>';
    } else {
      icon =
        '<path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>';
    }

    this.elements.volumeBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">${icon}</svg>`;
  }

  // Zoom Controls
  zoom(delta) {
    const newScale = Math.max(
      ZOOM_MIN,
      Math.min(ZOOM_MAX, this.state.zoom.scale + delta)
    );
    this.state.zoom.scale = newScale;

    if (newScale === 1) {
      this.resetZoom();
    } else {
      this.clampPan();
      this.applyTransform();
    }
  }

  toggleZoom() {
    if (this.state.zoom.scale === 1) {
      this.state.zoom.scale = 2;
    } else {
      this.resetZoom();
    }
    this.applyTransform();
  }

  resetZoom() {
    this.state.zoom = {
      scale: 1,
      translateX: 0,
      translateY: 0,
    };
    this.applyTransform();
  }

  clampPan() {
    const rect = this.elements.container.getBoundingClientRect();
    const maxX = Math.max(
      0,
      (rect.width * this.state.zoom.scale - rect.width) / 2
    );
    const maxY = Math.max(
      0,
      (rect.height * this.state.zoom.scale - rect.height) / 2
    );

    this.state.zoom.translateX = Math.min(
      maxX,
      Math.max(-maxX, this.state.zoom.translateX)
    );
    this.state.zoom.translateY = Math.min(
      maxY,
      Math.max(-maxY, this.state.zoom.translateY)
    );
  }

  applyTransform() {
    const { scale, translateX, translateY } = this.state.zoom;
    this.elements.video.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
    this.elements.zoomLabel.textContent = `${Math.round(scale * 100)}%`;
    this.savePlayerSettings();
  }

  // Screenshot
  takeScreenshot() {
    const canvas = document.createElement("canvas");
    canvas.width = this.elements.video.videoWidth;
    canvas.height = this.elements.video.videoHeight;

    const ctx = canvas.getContext("2d");
    ctx.drawImage(this.elements.video, 0, 0);

    // Flash effect
    const flash = document.createElement("div");
    flash.className = "screenshot-flash";
    this.elements.container.appendChild(flash);
    setTimeout(() => flash.remove(), 300);

    // Download
    canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `screenshot-${new Date()
        .toISOString()
        .slice(0, 19)
        .replace(/[:.]/g, "-")}.png`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  // Fullscreen
  toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      this.elements.container.requestFullscreen();
    }
  }

  onFullscreenChange() {
    const isFullscreen = !!document.fullscreenElement;
    this.elements.container.classList.toggle("fullscreen", isFullscreen);

    const icon = isFullscreen
      ? '<path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/>'
      : '<path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>';

    this.elements.fullscreenBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">${icon}</svg>`;
  }

  // Debug Panel
  toggleDebugPanel() {
    const isVisible = this.elements.debugPanel.classList.toggle("show");
    this.elements.debugBtn.classList.toggle("active", isVisible);

    if (isVisible) {
      this.startDebugMonitoring();
    } else {
      this.stopDebugMonitoring();
    }
  }

  startDebugMonitoring() {
    this.updateDebugInfo();
    this.debugInterval = setInterval(
      () => this.updateDebugInfo(),
      DEBUG_UPDATE_INTERVAL
    );
  }

  stopDebugMonitoring() {
    if (this.debugInterval) {
      clearInterval(this.debugInterval);
      this.debugInterval = null;
    }
  }

  async updateDebugInfo() {
    if (!this.sdk || !this.sdk.pc) {
      this.elements.debugContent.innerHTML = `
                <div class="debug-section">
                    <div class="debug-section-title">Not Connected</div>
                </div>
            `;
      return;
    }

    try {
      const stats = await this.sdk.pc.getStats();
      const report = this.parseStats(stats);

      switch (this.activeDebugTab) {
        case "stats":
          this.renderStatsTab(report);
          break;
        case "connection":
          this.renderConnectionTab(report);
          break;
        case "media":
          this.renderMediaTab(report);
          break;
      }

      this.updateStatsHistory(report);
    } catch (error) {
      console.error("Error updating debug info:", error);
    }
  }

  parseStats(stats) {
    const report = {
      video: {},
      audio: {},
      connection: {},
      codecs: {},
      candidates: [],
      streams: [],
    };

    stats.forEach((stat) => {
      if (stat.type === "inbound-rtp" && stat.mediaType === "video") {
        const prevVideo = this.lastStats.video || {};
        const timeDiff = (stat.timestamp - prevVideo.timestamp) / 1000 || 1;

        // Calculate real frame metrics
        const framesDecodedDelta =
          (stat.framesDecoded || 0) - (prevVideo.framesDecoded || 0);
        const framesDroppedDelta =
          (stat.framesDropped || 0) - (prevVideo.framesDropped || 0);
        const totalFramesDelta = framesDecodedDelta + framesDroppedDelta;
        const frameDropRate =
          totalFramesDelta > 0
            ? (framesDroppedDelta / totalFramesDelta) * 100
            : 0;

        // Track key frame intervals
        const keyFramesDelta =
          (stat.keyFramesDecoded || 0) - (this.state.lastKeyFrameCount || 0);
        if (keyFramesDelta > 0) {
          const currentTime = Date.now();
          if (this.performanceMetrics.lastKeyFrameTime > 0) {
            const keyFrameInterval =
              (currentTime - this.performanceMetrics.lastKeyFrameTime) / 1000;
            this.performanceMetrics.keyFrameTimestamps.push(keyFrameInterval);
            if (this.performanceMetrics.keyFrameTimestamps.length > 10) {
              this.performanceMetrics.keyFrameTimestamps.shift();
            }
          }
          this.performanceMetrics.lastKeyFrameTime = currentTime;
          this.state.lastKeyFrameCount = stat.keyFramesDecoded;
        }

        report.video = {
          resolution: `${stat.frameWidth || 0}x${stat.frameHeight || 0}`,
          fps: stat.framesPerSecond || 0,
          measuredFps: framesDecodedDelta / timeDiff,
          performanceFps: this.performanceMetrics.fps,
          videoFrameCallbackFps: this.performanceMetrics.videoFrameCallbackFps,
          bytesReceived: stat.bytesReceived || 0,
          bitrate:
            ((stat.bytesReceived - (prevVideo.bytesReceived || 0)) * 8) /
            timeDiff,
          packetsLost: stat.packetsLost || 0,
          packetsReceived: stat.packetsReceived || 0,
          jitter: stat.jitter * 1000 || 0,
          decoder: stat.decoderImplementation || "N/A",
          framesDecoded: stat.framesDecoded || 0,
          framesDropped: stat.framesDropped || 0,
          frameDropRate: frameDropRate,
          keyFramesDecoded: stat.keyFramesDecoded || 0,
          avgKeyFrameInterval:
            this.performanceMetrics.keyFrameTimestamps.length > 0
              ? (
                  this.performanceMetrics.keyFrameTimestamps.reduce(
                    (a, b) => a + b,
                    0
                  ) / this.performanceMetrics.keyFrameTimestamps.length
                ).toFixed(2)
              : "N/A",
          timestamp: stat.timestamp,
          pliCount: stat.pliCount || 0,
          nackCount: stat.nackCount || 0,
          firCount: stat.firCount || 0,
          qpSum: stat.qpSum || 0,
          totalDecodeTime: stat.totalDecodeTime || 0,
          totalInterFrameDelay: stat.totalInterFrameDelay || 0,
          totalSquaredInterFrameDelay: stat.totalSquaredInterFrameDelay || 0,
          framesReceived: stat.framesReceived || 0,
          headerBytesReceived: stat.headerBytesReceived || 0,
          bytesReceived: stat.bytesReceived || 0,
          lastPacketReceivedTimestamp: stat.lastPacketReceivedTimestamp || 0,
        };

        // Calculate average decode time
        if (stat.framesDecoded > 0) {
          report.video.avgDecodeTime = (
            (stat.totalDecodeTime / stat.framesDecoded) *
            1000
          ).toFixed(2);
        }

        // Track max FPS
        const currentFps =
          this.performanceMetrics.videoFrameCallbackFps || report.video.fps;
        if (currentFps > this.performanceMetrics.maxFpsAchieved) {
          this.performanceMetrics.maxFpsAchieved = currentFps;
        }

        this.lastStats.video = stat;
      } else if (stat.type === "inbound-rtp" && stat.mediaType === "audio") {
        const prevAudio = this.lastStats.audio || {};
        const timeDiff = (stat.timestamp - prevAudio.timestamp) / 1000 || 1;

        report.audio = {
          bytesReceived: stat.bytesReceived || 0,
          bitrate:
            ((stat.bytesReceived - (prevAudio.bytesReceived || 0)) * 8) /
            timeDiff,
          packetsLost: stat.packetsLost || 0,
          packetsReceived: stat.packetsReceived || 0,
          jitter: stat.jitter * 1000 || 0,
          audioLevel: stat.audioLevel || 0,
          timestamp: stat.timestamp,
          concealedSamples: stat.concealedSamples || 0,
          concealmentEvents: stat.concealmentEvents || 0,
          silentConcealedSamples: stat.silentConcealedSamples || 0,
          removedSamplesForAcceleration:
            stat.removedSamplesForAcceleration || 0,
          insertedSamplesForDeceleration:
            stat.insertedSamplesForDeceleration || 0,
        };

        this.lastStats.audio = stat;
      } else if (stat.type === "candidate-pair" && stat.state === "succeeded") {
        report.connection.rtt = stat.currentRoundTripTime
          ? stat.currentRoundTripTime * 1000
          : 0;
        report.connection.availableBitrate = stat.availableOutgoingBitrate || 0;
        report.connection.localCandidateType = stat.localCandidateType;
        report.connection.remoteCandidateType = stat.remoteCandidateType;
        report.connection.protocol = stat.protocol;
        report.connection.bytesSent = stat.bytesSent || 0;
        report.connection.bytesReceived = stat.bytesReceived || 0;
        report.connection.requestsReceived = stat.requestsReceived || 0;
        report.connection.requestsSent = stat.requestsSent || 0;
        report.connection.responsesReceived = stat.responsesReceived || 0;
        report.connection.responsesSent = stat.responsesSent || 0;
        report.connection.consentRequestsSent = stat.consentRequestsSent || 0;
      } else if (stat.type === "transport") {
        report.connection.dtlsState = stat.dtlsState;
        report.connection.iceState = stat.iceState;
        report.connection.selectedCandidatePairChanges =
          stat.selectedCandidatePairChanges || 0;
        report.connection.packetsReceived = stat.packetsReceived || 0;
        report.connection.packetsSent = stat.packetsSent || 0;
      } else if (stat.type === "codec") {
        if (stat.mimeType && stat.mimeType.includes("video")) {
          report.codecs.video = stat.mimeType;
          report.codecs.videoClockRate = stat.clockRate;
          report.codecs.videoPayloadType = stat.payloadType;
          report.codecs.videoImplementation = stat.implementation;
        } else if (stat.mimeType && stat.mimeType.includes("audio")) {
          report.codecs.audio = stat.mimeType;
          report.codecs.audioClockRate = stat.clockRate;
          report.codecs.audioPayloadType = stat.payloadType;
          report.codecs.audioChannels = stat.channels;
        }
      } else if (
        stat.type === "local-candidate" ||
        stat.type === "remote-candidate"
      ) {
        report.candidates.push({
          type: stat.type,
          protocol: stat.protocol,
          ip: stat.address || stat.ip,
          port: stat.port,
          candidateType: stat.candidateType,
          priority: stat.priority,
        });
      } else if (stat.type === "stream") {
        report.streams.push({
          id: stat.id,
          trackIds: stat.trackIds,
        });
      }
    });

    return report;
  }

  renderStatsTab(report) {
    let html = "";

    // Video Section
    if (report.video.resolution) {
      const packetLossRate =
        report.video.packetsReceived > 0
          ? (
              (report.video.packetsLost /
                (report.video.packetsLost + report.video.packetsReceived)) *
              100
            ).toFixed(2)
          : 0;

      // Use video frame callback FPS as primary metric
      const actualFps = report.video.videoFrameCallbackFps || report.video.fps;

      html += `
                <div class="debug-section">
                    <div class="debug-section-title">Video Statistics ${
                      this.state.codecType ? `(${this.state.codecType})` : ""
                    }</div>
                    <div class="debug-item">
                        <span class="debug-label">Resolution:</span>
                        <span class="debug-value">${
                          report.video.resolution
                        }</span>
                    </div>
                    <div class="debug-item">
                        <span class="debug-label">Actual FPS:</span>
                        <span class="debug-value ${this.getQualityClass(
                          actualFps,
                          "fps"
                        )}">${actualFps.toFixed(1)} fps</span>
                    </div>
                    <div class="debug-item">
                        <span class="debug-label">WebRTC Stats FPS:</span>
                        <span class="debug-value">${report.video.fps.toFixed(
                          1
                        )} fps</span>
                    </div>
                    <div class="debug-item">
                        <span class="debug-label">Calculated FPS:</span>
                        <span class="debug-value">${report.video.measuredFps.toFixed(
                          1
                        )} fps</span>
                    </div>
                    <div class="debug-item">
                        <span class="debug-label">Max FPS Achieved:</span>
                        <span class="debug-value ${this.getQualityClass(
                          this.performanceMetrics.maxFpsAchieved,
                          "fps"
                        )}">${this.performanceMetrics.maxFpsAchieved.toFixed(
        1
      )} fps</span>
                    </div>
                    <div class="debug-item">
                        <span class="debug-label">RAF Monitor FPS:</span>
                        <span class="debug-value ${this.getQualityClass(
                          report.video.performanceFps,
                          "fps"
                        )}">${report.video.performanceFps.toFixed(1)} fps</span>
                    </div>
                    <div class="debug-item">
                        <span class="debug-label">Presented Frames:</span>
                        <span class="debug-value">${
                          this.performanceMetrics.lastPresentedFrames || "N/A"
                        }</span>
                    </div>
                    <div class="debug-item">
                        <span class="debug-label">Bitrate:</span>
                        <span class="debug-value">${this.formatBitrate(
                          report.video.bitrate
                        )}</span>
                    </div>
                    <div class="debug-item">
                        <span class="debug-label">Decoder:</span>
                        <span class="debug-value">${report.video.decoder}</span>
                    </div>
                    <div class="debug-item">
                        <span class="debug-label">Avg Decode Time:</span>
                        <span class="debug-value">${
                          report.video.avgDecodeTime || "N/A"
                        } ms</span>
                    </div>
                    <div class="debug-item">
                        <span class="debug-label">Total Frames Decoded:</span>
                        <span class="debug-value">${
                          report.video.framesDecoded
                        }</span>
                    </div>
                    <div class="debug-item">
                        <span class="debug-label">Total Frames Dropped:</span>
                        <span class="debug-value">${
                          report.video.framesDropped
                        }</span>
                    </div>
                    <div class="debug-item">
                        <span class="debug-label">Frame Drop Rate:</span>
                        <span class="debug-value ${
                          report.video.frameDropRate > 5
                            ? "bad"
                            : report.video.frameDropRate > 1
                            ? "warning"
                            : "good"
                        }">${report.video.frameDropRate.toFixed(2)}%</span>
                    </div>
                    <div class="debug-item">
                        <span class="debug-label">Key Frames:</span>
                        <span class="debug-value">${
                          report.video.keyFramesDecoded
                        }</span>
                    </div>
                    <div class="debug-item">
                        <span class="debug-label">Avg Key Frame Interval:</span>
                        <span class="debug-value">${
                          report.video.avgKeyFrameInterval
                        } s</span>
                    </div>
                    <div class="debug-item">
                        <span class="debug-label">Packet Loss:</span>
                        <span class="debug-value ${this.getQualityClass(
                          packetLossRate,
                          "packetLoss"
                        )}">${packetLossRate}%</span>
                    </div>
                    <div class="debug-item">
                        <span class="debug-label">Jitter:</span>
                        <span class="debug-value ${this.getQualityClass(
                          report.video.jitter,
                          "jitter"
                        )}">${report.video.jitter.toFixed(1)} ms</span>
                    </div>
                    <div class="debug-item">
                        <span class="debug-label">PLI/NACK/FIR:</span>
                        <span class="debug-value">${report.video.pliCount}/${
        report.video.nackCount
      }/${report.video.firCount}</span>
                    </div>
                    <canvas class="graph-canvas" id="fps-graph" width="360" height="60"></canvas>
                </div>
            `;

      // Performance analysis based on actual FPS
      if (actualFps < 15) {
        html += `
                    <div class="perf-warning">
                        <div class="perf-warning-title">Low Frame Rate Detected</div>
                        <div>Actual FPS: ${actualFps.toFixed(
                          1
                        )} (from requestVideoFrameCallback)</div>
                        <div>Note: This is the real frame presentation rate in the browser.</div>
                        
                        <div style="margin-top: 8px;">Possible causes:</div>
                        <ul style="margin: 8px 0 0 20px; padding: 0;">
                            <li>Source stream is not sending 60fps</li>
                            <li>SRS transcoding limitations</li>
                            <li>Network congestion (check jitter: ${report.video.jitter.toFixed(
                              1
                            )}ms)</li>
                            <li>Browser/hardware decoding limitations</li>
                            <li>Check if GPU acceleration is enabled</li>
                        </ul>
                        
                        <div style="margin-top: 8px;">Diagnostics:</div>
                        <ul style="margin: 4px 0 0 20px; padding: 0;">
                            <li>PLI Count: ${
                              report.video.pliCount
                            } (Picture Loss Indication)</li>
                            <li>NACK Count: ${
                              report.video.nackCount
                            } (Negative Acknowledgment)</li>
                            <li>FIR Count: ${
                              report.video.firCount
                            } (Full Intra Request)</li>
                            <li>Key Frame Interval: ${
                              report.video.avgKeyFrameInterval
                            }s</li>
                        </ul>
                    </div>
                `;
      }
    }

    // Audio Section
    if (report.audio.bytesReceived !== undefined) {
      const audioPacketLossRate =
        report.audio.packetsReceived > 0
          ? (
              (report.audio.packetsLost /
                (report.audio.packetsLost + report.audio.packetsReceived)) *
              100
            ).toFixed(2)
          : 0;

      html += `
                <div class="debug-section">
                    <div class="debug-section-title">Audio Statistics</div>
                    <div class="debug-item">
                        <span class="debug-label">Bitrate:</span>
                        <span class="debug-value">${this.formatBitrate(
                          report.audio.bitrate
                        )}</span>
                    </div>
                    <div class="debug-item">
                        <span class="debug-label">Audio Level:</span>
                        <span class="debug-value">${(
                          report.audio.audioLevel * 100
                        ).toFixed(1)}%</span>
                    </div>
                    <div class="debug-item">
                        <span class="debug-label">Packet Loss:</span>
                        <span class="debug-value ${this.getQualityClass(
                          audioPacketLossRate,
                          "packetLoss"
                        )}">${audioPacketLossRate}%</span>
                    </div>
                    <div class="debug-item">
                        <span class="debug-label">Jitter:</span>
                        <span class="debug-value ${this.getQualityClass(
                          report.audio.jitter,
                          "jitter"
                        )}">${report.audio.jitter.toFixed(1)} ms</span>
                    </div>
                    <div class="debug-item">
                        <span class="debug-label">Concealed Samples:</span>
                        <span class="debug-value">${
                          report.audio.concealedSamples
                        }</span>
                    </div>
                    <div class="debug-item">
                        <span class="debug-label">Concealment Events:</span>
                        <span class="debug-value">${
                          report.audio.concealmentEvents
                        }</span>
                    </div>
                    <canvas class="graph-canvas" id="audio-graph" width="360" height="60"></canvas>
                </div>
            `;
    }

    // Export button
    html += `<button class="export-btn" onclick="window.player.exportDebugData()">Export Debug Data</button>`;

    this.elements.debugContent.innerHTML = html;

    // Draw graphs - use videoFrameCallbackFps for FPS graph
    requestAnimationFrame(() => {
      const fpsData =
        this.statsHistory.videoFrameCallbackFps.length > 0
          ? this.statsHistory.videoFrameCallbackFps
          : this.statsHistory.fps;
      this.drawGraph("fps-graph", fpsData, 70, "Actual FPS");
      this.drawGraph(
        "audio-graph",
        this.statsHistory.bitrate,
        Math.max(...this.statsHistory.bitrate, 1000000),
        "Audio Bitrate"
      );
    });
  }

  renderConnectionTab(report) {
    let html = `
            <div class="debug-section">
                <div class="debug-section-title">Connection Info</div>
        `;

    if (report.connection.dtlsState) {
      const totalBytes =
        (report.connection.bytesSent || 0) +
        (report.connection.bytesReceived || 0);

      html += `
                <div class="debug-item">
                    <span class="debug-label">Connection State:</span>
                    <span class="debug-value">${
                      this.sdk.pc.connectionState
                    }</span>
                </div>
                <div class="debug-item">
                    <span class="debug-label">DTLS State:</span>
                    <span class="debug-value">${
                      report.connection.dtlsState
                    }</span>
                </div>
                <div class="debug-item">
                    <span class="debug-label">ICE State:</span>
                    <span class="debug-value">${
                      report.connection.iceState
                    }</span>
                </div>
                <div class="debug-item">
                    <span class="debug-label">Protocol:</span>
                    <span class="debug-value">${
                      report.connection.protocol || "N/A"
                    }</span>
                </div>
                <div class="debug-item">
                    <span class="debug-label">RTT:</span>
                    <span class="debug-value ${this.getQualityClass(
                      report.connection.rtt,
                      "rtt"
                    )}">${
        report.connection.rtt ? report.connection.rtt.toFixed(1) + " ms" : "N/A"
      }</span>
                </div>
                <div class="debug-item">
                    <span class="debug-label">Available Bandwidth:</span>
                    <span class="debug-value">${this.formatBitrate(
                      report.connection.availableBitrate
                    )}</span>
                </div>
                <div class="debug-item">
                    <span class="debug-label">Local Candidate:</span>
                    <span class="debug-value">${
                      report.connection.localCandidateType || "N/A"
                    }</span>
                </div>
                <div class="debug-item">
                    <span class="debug-label">Remote Candidate:</span>
                    <span class="debug-value">${
                      report.connection.remoteCandidateType || "N/A"
                    }</span>
                </div>
                <div class="debug-item">
                    <span class="debug-label">Total Data Transfer:</span>
                    <span class="debug-value">${this.formatBytes(
                      totalBytes
                    )}</span>
                </div>
                <div class="debug-item">
                    <span class="debug-label">Packets Received:</span>
                    <span class="debug-value">${
                      report.connection.packetsReceived || 0
                    }</span>
                </div>
                <div class="debug-item">
                    <span class="debug-label">Candidate Pair Changes:</span>
                    <span class="debug-value">${
                      report.connection.selectedCandidatePairChanges
                    }</span>
                </div>
                <div class="debug-item">
                    <span class="debug-label">STUN Requests Sent:</span>
                    <span class="debug-value">${
                      report.connection.requestsSent || 0
                    }</span>
                </div>
                <div class="debug-item">
                    <span class="debug-label">STUN Responses Received:</span>
                    <span class="debug-value">${
                      report.connection.responsesReceived || 0
                    }</span>
                </div>
            `;
    }

    html += `</div>`;

    // ICE Candidates
    if (report.candidates.length > 0) {
      html += `
                <div class="debug-section">
                    <div class="debug-section-title">ICE Candidates</div>
            `;

      const localCandidates = report.candidates.filter(
        (c) => c.type === "local-candidate"
      );
      const remoteCandidates = report.candidates.filter(
        (c) => c.type === "remote-candidate"
      );

      if (localCandidates.length > 0) {
        html += `<div style="margin-bottom: 12px; font-weight: 500;">Local:</div>`;
        localCandidates.forEach((c) => {
          html += `<div style="margin-left: 16px; margin-bottom: 4px; font-size: 11px; opacity: 0.8;">${c.candidateType} - ${c.protocol} ${c.ip}:${c.port} (priority: ${c.priority})</div>`;
        });
      }

      if (remoteCandidates.length > 0) {
        html += `<div style="margin-bottom: 12px; margin-top: 12px; font-weight: 500;">Remote:</div>`;
        remoteCandidates.forEach((c) => {
          html += `<div style="margin-left: 16px; margin-bottom: 4px; font-size: 11px; opacity: 0.8;">${c.candidateType} - ${c.protocol} ${c.ip}:${c.port}</div>`;
        });
      }

      html += `</div>`;
    }

    // SDP Info
    if (this.sdpInfo.remote) {
      const videoParams = this.extractVideoParams(this.sdpInfo.remote);
      html += `
                <div class="debug-section">
                    <div class="debug-section-title">SDP Video Parameters</div>
                    ${
                      videoParams.codec
                        ? `
                    <div class="debug-item">
                        <span class="debug-label">Codec:</span>
                        <span class="debug-value">${videoParams.codec}</span>
                    </div>
                    `
                        : ""
                    }
                    ${
                      videoParams.profileLevelId
                        ? `
                    <div class="debug-item">
                        <span class="debug-label">Profile Level ID:</span>
                        <span class="debug-value">${videoParams.profileLevelId}</span>
                    </div>
                    `
                        : ""
                    }
                    ${
                      videoParams.h265ProfileId
                        ? `
                    <div class="debug-item">
                        <span class="debug-label">H265 Profile ID:</span>
                        <span class="debug-value">${videoParams.h265ProfileId}</span>
                    </div>
                    `
                        : ""
                    }
                    ${
                      videoParams.levelId
                        ? `
                    <div class="debug-item">
                        <span class="debug-label">Level ID:</span>
                        <span class="debug-value">${videoParams.levelId}</span>
                    </div>
                    `
                        : ""
                    }
                    ${
                      videoParams.tierFlag !== undefined
                        ? `
                    <div class="debug-item">
                        <span class="debug-label">Tier Flag:</span>
                        <span class="debug-value">${
                          videoParams.tierFlag === 1 ? "High" : "Main"
                        }</span>
                    </div>
                    `
                        : ""
                    }
                    ${
                      videoParams.txMode
                        ? `
                    <div class="debug-item">
                        <span class="debug-label">TX Mode:</span>
                        <span class="debug-value">${videoParams.txMode}</span>
                    </div>
                    `
                        : ""
                    }
                </div>
            `;
    }

    // RTT Graph
    html += `
            <div class="debug-section">
                <div class="debug-section-title">Round Trip Time</div>
                <canvas class="graph-canvas" id="rtt-graph" width="360" height="60"></canvas>
            </div>
        `;

    this.elements.debugContent.innerHTML = html;

    // Draw graphs
    requestAnimationFrame(() => {
      this.drawGraph(
        "rtt-graph",
        this.statsHistory.rtt,
        Math.max(...this.statsHistory.rtt, 200),
        "RTT (ms)"
      );
    });
  }

  renderMediaTab(report) {
    let html = `
            <div class="debug-section">
                <div class="debug-section-title">Codecs</div>
        `;

    if (report.codecs.video) {
      html += `
                <div class="debug-item">
                    <span class="debug-label">Video Codec:</span>
                    <span class="debug-value">${report.codecs.video} ${
        this.state.codecType ? `(${this.state.codecType})` : ""
      }</span>
                </div>
                <div class="debug-item">
                    <span class="debug-label">Implementation:</span>
                    <span class="debug-value">${
                      report.codecs.videoImplementation || "N/A"
                    }</span>
                </div>
                <div class="debug-item">
                    <span class="debug-label">Clock Rate:</span>
                    <span class="debug-value">${
                      report.codecs.videoClockRate
                    } Hz</span>
                </div>
                <div class="debug-item">
                    <span class="debug-label">Payload Type:</span>
                    <span class="debug-value">${
                      report.codecs.videoPayloadType
                    }</span>
                </div>
            `;
    }

    if (report.codecs.audio) {
      html += `
                <div class="debug-item" style="margin-top: 16px;">
                    <span class="debug-label">Audio Codec:</span>
                    <span class="debug-value">${report.codecs.audio}</span>
                </div>
                <div class="debug-item">
                    <span class="debug-label">Clock Rate:</span>
                    <span class="debug-value">${
                      report.codecs.audioClockRate
                    } Hz</span>
                </div>
                <div class="debug-item">
                    <span class="debug-label">Channels:</span>
                    <span class="debug-value">${
                      report.codecs.audioChannels || "N/A"
                    }</span>
                </div>
                <div class="debug-item">
                    <span class="debug-label">Payload Type:</span>
                    <span class="debug-value">${
                      report.codecs.audioPayloadType
                    }</span>
                </div>
            `;
    }

    html += `</div>`;

    // Player State
    const uptime = Math.floor((Date.now() - this.statsStartTime) / 1000);
    const uptimeStr = `${Math.floor(uptime / 60)}m ${uptime % 60}s`;

    html += `
            <div class="debug-section">
                <div class="debug-section-title">Player State</div>
                <div class="debug-item">
                    <span class="debug-label">Uptime:</span>
                    <span class="debug-value">${uptimeStr}</span>
                </div>
                <div class="debug-item">
                    <span class="debug-label">Ready State:</span>
                    <span class="debug-value">${
                      [
                        "HAVE_NOTHING",
                        "HAVE_METADATA",
                        "HAVE_CURRENT_DATA",
                        "HAVE_FUTURE_DATA",
                        "HAVE_ENOUGH_DATA",
                      ][this.elements.video.readyState]
                    }</span>
                </div>
                <div class="debug-item">
                    <span class="debug-label">Network State:</span>
                    <span class="debug-value">${
                      [
                        "NETWORK_EMPTY",
                        "NETWORK_IDLE",
                        "NETWORK_LOADING",
                        "NETWORK_NO_SOURCE",
                      ][this.elements.video.networkState]
                    }</span>
                </div>
                <div class="debug-item">
                    <span class="debug-label">Video Width:</span>
                    <span class="debug-value">${
                      this.elements.video.videoWidth
                    }</span>
                </div>
                <div class="debug-item">
                    <span class="debug-label">Video Height:</span>
                    <span class="debug-value">${
                      this.elements.video.videoHeight
                    }</span>
                </div>
                <div class="debug-item">
                    <span class="debug-label">Display Size:</span>
                    <span class="debug-value">${
                      this.elements.video.clientWidth
                    }x${this.elements.video.clientHeight}</span>
                </div>
                <div class="debug-item">
                    <span class="debug-label">Buffered:</span>
                    <span class="debug-value">${
                      this.elements.video.buffered.length > 0
                        ? this.elements.video.buffered.end(0).toFixed(1) + "s"
                        : "0s"
                    }</span>
                </div>
                <div class="debug-item">
                    <span class="debug-label">Current Time:</span>
                    <span class="debug-value">${this.elements.video.currentTime.toFixed(
                      1
                    )}s</span>
                </div>
                <div class="debug-item">
                    <span class="debug-label">Volume:</span>
                    <span class="debug-value">${Math.round(
                      this.elements.video.volume * 100
                    )}%</span>
                </div>
                <div class="debug-item">
                    <span class="debug-label">Muted:</span>
                    <span class="debug-value">${
                      this.elements.video.muted ? "Yes" : "No"
                    }</span>
                </div>
                <div class="debug-item">
                    <span class="debug-label">Playback Rate:</span>
                    <span class="debug-value">${
                      this.elements.video.playbackRate
                    }x</span>
                </div>
            </div>
        `;

    // Browser capabilities
    html += `
            <div class="debug-section">
                <div class="debug-section-title">Browser Capabilities</div>
                <div class="debug-item">
                    <span class="debug-label">requestVideoFrameCallback:</span>
                    <span class="debug-value ${
                      "requestVideoFrameCallback" in HTMLVideoElement.prototype
                        ? "good"
                        : "bad"
                    }">
                        ${
                          "requestVideoFrameCallback" in
                          HTMLVideoElement.prototype
                            ? "Supported"
                            : "Not Supported"
                        }
                    </span>
                </div>
                <div class="debug-item">
                    <span class="debug-label">User Agent:</span>
                    <span class="debug-value" style="font-size: 11px; word-break: break-all;">${
                      navigator.userAgent
                    }</span>
                </div>
            </div>
        `;

    // Streams
    if (report.streams.length > 0) {
      html += `
                <div class="debug-section">
                    <div class="debug-section-title">Media Streams</div>
            `;
      report.streams.forEach((stream, index) => {
        html += `
                    <div class="debug-item">
                        <span class="debug-label">Stream ${index + 1}:</span>
                        <span class="debug-value" style="font-size: 11px;">${
                          stream.id
                        }</span>
                    </div>
                `;
      });
      html += `</div>`;
    }

    this.elements.debugContent.innerHTML = html;
  }

  updateStatsHistory(report) {
    const maxHistory = STATS_HISTORY_SIZE;

    if (report.video.fps !== undefined) {
      this.statsHistory.fps.push(report.video.fps);
      if (this.statsHistory.fps.length > maxHistory) {
        this.statsHistory.fps.shift();
      }
    }

    if (report.video.videoFrameCallbackFps !== undefined) {
      this.statsHistory.videoFrameCallbackFps.push(
        report.video.videoFrameCallbackFps
      );
      if (this.statsHistory.videoFrameCallbackFps.length > maxHistory) {
        this.statsHistory.videoFrameCallbackFps.shift();
      }
    }

    if (report.audio.bitrate !== undefined) {
      this.statsHistory.bitrate.push(report.audio.bitrate);
      if (this.statsHistory.bitrate.length > maxHistory) {
        this.statsHistory.bitrate.shift();
      }
    }

    if (report.connection.rtt !== undefined) {
      this.statsHistory.rtt.push(report.connection.rtt);
      if (this.statsHistory.rtt.length > maxHistory) {
        this.statsHistory.rtt.shift();
      }
    }

    if (report.video.framesDecoded !== undefined) {
      this.statsHistory.framesDecoded.push(report.video.framesDecoded);
      if (this.statsHistory.framesDecoded.length > maxHistory) {
        this.statsHistory.framesDecoded.shift();
      }
    }

    if (report.video.framesDropped !== undefined) {
      this.statsHistory.framesDropped.push(report.video.framesDropped);
      if (this.statsHistory.framesDropped.length > maxHistory) {
        this.statsHistory.framesDropped.shift();
      }
    }
  }

  drawGraph(canvasId, data, maxValue, label) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !data || data.length === 0) return;

    const ctx = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;

    // Clear canvas
    ctx.fillStyle = "rgba(255, 255, 255, 0.02)";
    ctx.fillRect(0, 0, width, height);

    if (data.length < 2) return;

    // Auto-scale if needed
    const dataMax = Math.max(...data);
    if (dataMax > maxValue) {
      maxValue = dataMax * 1.2;
    }

    // Draw grid
    ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = (height / 4) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // Draw target line for FPS
    if (label.includes("FPS")) {
      ctx.strokeStyle = "rgba(76, 175, 80, 0.3)";
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 5]);
      const targetY = height - (60 / maxValue) * height;
      ctx.beginPath();
      ctx.moveTo(0, targetY);
      ctx.lineTo(width, targetY);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Draw data line
    const currentValue = data[data.length - 1];
    ctx.strokeStyle =
      currentValue >= 55
        ? "#4CAF50"
        : currentValue >= 30
        ? "#FFC107"
        : "#F44336";
    ctx.lineWidth = 2;
    ctx.beginPath();

    const dataLength = Math.min(data.length, STATS_HISTORY_SIZE);
    const xStep = width / (STATS_HISTORY_SIZE - 1);

    data.forEach((value, index) => {
      const x = index * xStep;
      const y = height - (value / maxValue) * height;

      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });

    ctx.stroke();

    // Draw current value point
    const currentY = height - (currentValue / maxValue) * height;

    ctx.fillStyle = ctx.strokeStyle;
    ctx.beginPath();
    ctx.arc(data.length * xStep - xStep, currentY, 3, 0, Math.PI * 2);
    ctx.fill();

    // Draw labels
    ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
    ctx.font = "11px sans-serif";
    ctx.fillText(label, 5, 15);

    // Format current value
    let valueText;
    if (label.includes("FPS")) {
      valueText = currentValue.toFixed(1);
      // Add target indicator
      ctx.fillStyle = "rgba(76, 175, 80, 0.8)";
      ctx.fillText("Target: 60", width - 60, 15);
      ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
    } else if (label.includes("Bitrate")) {
      valueText = this.formatBitrate(currentValue);
    } else {
      valueText = currentValue.toFixed(0);
    }
    ctx.fillText(valueText, width - ctx.measureText(valueText).width - 5, 30);
  }

  exportDebugData() {
    const timestamp = new Date().toISOString();
    const uptime = Math.floor((Date.now() - this.statsStartTime) / 1000);

    const data = {
      timestamp,
      url: location.href,
      userAgent: navigator.userAgent,
      codec: this.state.codecType,
      stats: {
        history: this.statsHistory,
        current: this.lastStats,
        maxFpsAchieved: this.performanceMetrics.maxFpsAchieved,
        lastPresentedFrames: this.performanceMetrics.lastPresentedFrames,
      },
      sdp: this.sdpInfo,
      connectionQuality: this.state.connectionQuality,
      playerState: {
        uptime: uptime,
        readyState: this.elements.video.readyState,
        networkState: this.elements.video.networkState,
        videoWidth: this.elements.video.videoWidth,
        videoHeight: this.elements.video.videoHeight,
        displayWidth: this.elements.video.clientWidth,
        displayHeight: this.elements.video.clientHeight,
        duration: this.elements.video.duration,
        currentTime: this.elements.video.currentTime,
        buffered:
          this.elements.video.buffered.length > 0
            ? this.elements.video.buffered.end(0)
            : 0,
        volume: this.elements.video.volume,
        muted: this.elements.video.muted,
        playbackRate: this.elements.video.playbackRate,
      },
      performance: {
        keyFrameIntervals: this.performanceMetrics.keyFrameTimestamps,
        videoFrameCallbackSupported:
          "requestVideoFrameCallback" in HTMLVideoElement.prototype,
      },
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `webrtc-debug-${timestamp.replace(/[:.]/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Helper Methods
  formatBytes(bytes) {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  }

  formatBitrate(bitsPerSecond) {
    if (bitsPerSecond === 0) return "0 bps";
    const k = 1000;
    const sizes = ["bps", "Kbps", "Mbps", "Gbps"];
    const i = Math.floor(Math.log(bitsPerSecond) / Math.log(k));
    return (
      parseFloat((bitsPerSecond / Math.pow(k, i)).toFixed(2)) + " " + sizes[i]
    );
  }

  getQualityClass(value, type) {
    if (type === "fps") {
      if (value >= 55) return "good";
      if (value >= 30) return "warning";
      return "bad";
    } else if (type === "packetLoss") {
      if (value <= 1) return "good";
      if (value <= 5) return "warning";
      return "bad";
    } else if (type === "jitter") {
      if (value <= 30) return "good";
      if (value <= 100) return "warning";
      return "bad";
    } else if (type === "rtt") {
      if (value <= 50) return "good";
      if (value <= 150) return "warning";
      return "bad";
    }
    return "";
  }

  // Settings persistence
  savePlayerSettings() {
    const settings = {
      volume: this.elements.volumeSlider.value,
      muted: this.elements.video.muted,
    };
    localStorage.setItem("webrtc-player-settings", JSON.stringify(settings));
  }

  loadPlayerSettings() {
    try {
      const settings = JSON.parse(
        localStorage.getItem("webrtc-player-settings") || "{}"
      );

      if (settings.volume !== undefined) {
        this.elements.volumeSlider.value = settings.volume;
        this.setVolume(settings.volume);
      }

      if (settings.muted !== undefined) {
        this.elements.video.muted = settings.muted;
        this.updateVolumeIcon();
      }
    } catch (error) {
      console.error("Error loading settings:", error);
    }
  }

  onVideoLoaded() {
    // Auto unmute after user interaction
    document.body.addEventListener(
      "click",
      () => {
        if (this.elements.video.muted && this.elements.volumeSlider.value > 0) {
          this.elements.video.muted = false;
          this.updateVolumeIcon();
        }
      },
      { once: true }
    );

    // Log video properties
    console.log("Video loaded:", {
      width: this.elements.video.videoWidth,
      height: this.elements.video.videoHeight,
      readyState: this.elements.video.readyState,
      codec: this.state.codecType,
    });
  }
}
