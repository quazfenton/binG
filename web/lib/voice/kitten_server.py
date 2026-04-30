import os
import sys
import uuid
import base64
import uvicorn
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional
import soundfile as sf
from kittentts import KittenTTS

app = FastAPI(title="KittenTTS Local Server")

# Model cache
models = {}

class TTSRequest(BaseModel):
    text: str
    voice: Optional[str] = "Bruno"
    model_id: Optional[str] = "KittenML/kitten-tts-mini-0.8"
    speed: Optional[float] = 1.0

def get_model(model_id: str):
    if model_id not in models:
        print(f"Loading model: {model_id}...")
        models[model_id] = KittenTTS(model_id)
    return models[model_id]

@app.post("/generate")
async def generate(request: TTSRequest):
    try:
        m = get_model(request.model_id)
        audio = m.generate(text=request.text, voice=request.voice, speed=request.speed)
        
        # Save to a unique temp file
        temp_filename = f"temp_{uuid.uuid4()}.wav"
        sf.write(temp_filename, audio, 24000)
        
        # Read and encode
        with open(temp_filename, "rb") as f:
            audio_bytes = f.read()
        
        # Cleanup
        os.remove(temp_filename)
        
        return {
            "success": True,
            "audioData": base64.b64encode(audio_bytes).decode("utf-8"),
            "format": "wav",
            "sampleRate": 24000
        }
    except Exception as e:
        print(f"Error generating audio: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/health")
async def health():
    return {"status": "ok", "models_loaded": list(models.keys())}

if __name__ == "__main__":
    port = int(os.environ.get("KITTEN_TTS_PORT", 8005))
    uvicorn.run(app, host="127.0.0.1", port=port)
