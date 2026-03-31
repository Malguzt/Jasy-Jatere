FROM nvidia/cuda:12.2.0-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y \
    python3 python3-pip ffmpeg libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt

# Pre-download YOLOv8 nano model during build
RUN python3 -c "from ultralytics import YOLO; YOLO('yolov8n.pt')"

COPY . .

EXPOSE 5000

CMD ["python3", "detector.py"]
