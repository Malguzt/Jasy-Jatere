FROM pytorch/pytorch:2.2.1-cuda12.1-cudnn8-devel

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1

# Install system dependencies for OpenCV and FFmpeg
RUN apt-get update && apt-get install -y \
    ffmpeg \
    libgl1-mesa-glx \
    libglib2.0-0 \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN pip install --no-cache-dir -U pip setuptools wheel

# Copy and install requirements
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download BasicVSR++ model or essential weights if possible
# (MMMagic will download them on first use, but we can cache them)

COPY . .

EXPOSE 5001

CMD ["python", "reconstructor.py"]
