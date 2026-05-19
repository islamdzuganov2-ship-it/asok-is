from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import logging
import sys

from app.core.database import Base, engine
from app.api.v1.api import api_router

@asynccontextmanager
async def lifespan(app: FastAPI):
    logging.info("🚀 Starting ASOK IS Backend v2.0.0...")
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
    except Exception as e:
        logging.error(f"❌ Failed to create tables: {e}")
        raise
    yield
    await engine.dispose()

app = FastAPI(title="АСОК ИС", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix="/api/v1")

@app.get("/health")
async def health_check():
    return {"status": "ok"}