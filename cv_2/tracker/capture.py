from __future__ import annotations

import sys
import threading
import time

import cv2
import numpy as np


def _backend() -> int:
    if sys.platform == "win32":
        return cv2.CAP_DSHOW
    if sys.platform == "darwin":
        return cv2.CAP_AVFOUNDATION
    return cv2.CAP_ANY


class Camera:
    """Webcam reader on its own thread that keeps only the newest frame, so a slow
    consumer sees fresh frames instead of a growing backlog."""

    def __init__(self, index: int = 0, width: int = 640, height: int = 480):
        self.index, self.width, self.height = index, width, height
        self._cap: cv2.VideoCapture | None = None
        self._frame: np.ndarray | None = None
        self._seq = 0
        self._cond = threading.Condition()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> "Camera":
        cap = cv2.VideoCapture(self.index, _backend())
        if not cap.isOpened():
            cap.release()
            raise RuntimeError(
                f"Could not open camera {self.index}. Close other apps using it and, on "
                "macOS, allow camera access for your terminal/IDE."
            )
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, self.width)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self.height)
        self._cap = cap
        self._thread = threading.Thread(target=self._run, name="camera", daemon=True)
        self._thread.start()
        return self

    def _run(self) -> None:
        assert self._cap is not None
        while not self._stop.is_set():
            ok, frame = self._cap.read()
            if not ok:
                time.sleep(0.01)
                continue
            with self._cond:
                self._frame, self._seq = frame, self._seq + 1
                self._cond.notify_all()

    def read(self, last_seq: int = 0, timeout: float = 1.0) -> tuple[int, np.ndarray | None]:
        """Block until a frame newer than last_seq exists. Returns (seq, frame|None on timeout)."""
        with self._cond:
            self._cond.wait_for(lambda: self._seq > last_seq or self._stop.is_set(), timeout)
            if self._seq > last_seq and self._frame is not None:
                return self._seq, self._frame
            return last_seq, None

    def stop(self) -> None:
        self._stop.set()
        with self._cond:
            self._cond.notify_all()
        if self._thread:
            self._thread.join(timeout=2)
        if self._cap:
            self._cap.release()
