import os
import uuid

from celery.result import AsyncResult
from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status

from app.core.config import settings
from app.workers.tasks import celery_app, parse_excel_task

router = APIRouter()

MAX_UPLOAD_SIZE = 10 * 1024 * 1024


@router.post("/upload")
async def upload_excel(period_id: str = Form(...), file: UploadFile = File(...)) -> dict[str, str]:
    if not file.filename or not file.filename.lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="Only .xlsx files are supported")

    content = await file.read()
    if len(content) > MAX_UPLOAD_SIZE:
        raise HTTPException(status_code=413, detail="File is larger than 10 MB")

    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
    safe_name = f"{uuid.uuid4()}_{os.path.basename(file.filename)}"
    file_path = os.path.join(settings.UPLOAD_DIR, safe_name)
    with open(file_path, "wb") as target:
        target.write(content)

    task = parse_excel_task.delay(file_path, period_id)
    return {"task_id": task.id}


@router.get("/tasks/{task_id}")
async def get_task_status(task_id: str) -> dict[str, object]:
    result = AsyncResult(task_id, app=celery_app)
    payload: dict[str, object] = {"task_id": task_id, "status": result.status}
    if result.ready():
        if result.failed():
            payload["error"] = str(result.result)
        else:
            payload["result"] = result.result
    return payload
