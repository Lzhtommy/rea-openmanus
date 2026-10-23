"""Media generation (Manus' image / speech / video creation) through the model gateway.

Runs in the backend so gateway keys never enter the sandbox; results are written into the sandbox as
files. Each kind has its own model setting (MANUS_IMAGE_MODEL / MANUS_TTS_MODEL / MANUS_VIDEO_MODEL);
an empty setting means the capability is off and the tool says so.

- image: OpenAI images API (`size` picks the aspect ratio). With reference images it uses a chat
  completion with image output instead, which lets the model edit or combine the inputs.
- speech: OpenAI audio.speech API.
- video: OpenAI-compatible videos API (create, poll, download content), as LiteLLM exposes it.
"""

from __future__ import annotations

import asyncio
import base64
import time

import httpx
import openai

from . import config

SIZES = {"1:1": "1024x1024", "16:9": "1792x1024", "9:16": "1024x1792", "4:3": "1536x1152", "3:4": "1152x1536"}


class MediaError(Exception):
    pass


def _client() -> openai.AsyncOpenAI:
    return openai.AsyncOpenAI(base_url=config.LLM_BASE_URL, api_key=config.LLM_API_KEY, timeout=300, max_retries=1)


def _why(e: Exception) -> str:
    body = getattr(e, "body", None)
    err = body.get("error", body) if isinstance(body, dict) else None
    msg = err.get("message") if isinstance(err, dict) else getattr(e, "message", str(e))
    return str(msg)[:300]


async def generate_image(prompt: str, references: list[tuple[bytes, str]] | None = None, aspect_ratio: str = "16:9") -> bytes:
    """PNG bytes. references: (bytes, mime) of input images to edit or draw from."""
    model = config.IMAGE_MODEL
    if not model:
        raise MediaError("image generation is not configured (MANUS_IMAGE_MODEL)")
    c = _client()
    try:
        if references:
            parts = [{"type": "text", "text": f"{prompt}\n(Output aspect ratio: {aspect_ratio}.)"}] + [
                {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{base64.b64encode(b).decode()}"}}
                for b, mime in references]
            r = await c.chat.completions.create(model=model, messages=[{"role": "user", "content": parts}],
                                                extra_body={"modalities": ["image", "text"]})
            images = (r.choices[0].message.model_extra or {}).get("images") or []
            if not images:
                raise MediaError(f"the model returned no image: {(r.choices[0].message.content or '')[:200]}")
            return base64.b64decode(images[0]["image_url"]["url"].split(",", 1)[1])
        r = await c.images.generate(model=model, prompt=prompt, n=1, size=SIZES.get(aspect_ratio, "1792x1024"))
        d = r.data[0]
        if d.b64_json:
            return base64.b64decode(d.b64_json)
        if d.url:
            async with httpx.AsyncClient(timeout=120) as h:
                return (await h.get(d.url)).content
        raise MediaError("the model returned no image")
    except openai.OpenAIError as e:
        raise MediaError(_why(e))
    finally:
        await c.close()


async def generate_speech(text: str, voice: str = "") -> bytes:
    model = config.TTS_MODEL
    if not model:
        raise MediaError("speech generation is not configured (MANUS_TTS_MODEL)")
    c = _client()
    try:
        r = await c.audio.speech.create(model=model, voice=voice or config.TTS_VOICE, input=text, response_format="mp3")
        return r.read()
    except openai.OpenAIError as e:
        raise MediaError(_why(e))
    finally:
        await c.close()


async def generate_video(prompt: str, seconds: int = 8, reference: tuple[bytes, str] | None = None,
                         aspect_ratio: str = "16:9", timeout: float = 900, on_progress=None) -> bytes:
    """MP4 bytes; polls the job until it finishes."""
    model = config.VIDEO_MODEL
    if not model:
        raise MediaError("video generation is not configured (MANUS_VIDEO_MODEL)")
    base = config.LLM_BASE_URL.rstrip("/").removesuffix("/v1")
    headers = {"Authorization": f"Bearer {config.LLM_API_KEY}"}
    size = {"16:9": "1280x720", "9:16": "720x1280", "1:1": "1024x1024"}.get(aspect_ratio, "1280x720")
    async with httpx.AsyncClient(timeout=120, headers=headers) as h:
        data = {"model": model, "prompt": prompt, "seconds": str(seconds), "size": size}
        if reference:
            r = await h.post(f"{base}/v1/videos", data=data, files={"input_reference": ("reference", reference[0], reference[1])})
        else:
            r = await h.post(f"{base}/v1/videos", json=data)
        if r.status_code >= 400:
            raise MediaError(f"video request rejected (HTTP {r.status_code}): {r.text[:300]}")
        job = r.json()
        vid, start = job.get("id"), time.time()
        while job.get("status") not in ("completed", "failed", "cancelled"):
            if time.time() - start > timeout:
                raise MediaError("video generation timed out")
            await asyncio.sleep(8)
            job = (await h.get(f"{base}/v1/videos/{vid}")).json()
            if on_progress and job.get("progress") is not None:
                on_progress(job["progress"])
        if job["status"] != "completed":
            raise MediaError(f"video generation {job['status']}: {str(job.get('error') or '')[:300]}")
        r = await h.get(f"{base}/v1/videos/{vid}/content")
        if r.status_code >= 400:
            raise MediaError(f"could not download the video (HTTP {r.status_code})")
        return r.content


def capabilities() -> dict:
    return {"image": bool(config.IMAGE_MODEL), "speech": bool(config.TTS_MODEL), "video": bool(config.VIDEO_MODEL)}
