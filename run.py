"""从项目根目录启动：uvicorn backend.main:app --reload --port 8000"""
import uvicorn

if __name__ == "__main__":
    uvicorn.run("backend.main:app", host="127.0.0.1", port=8000, reload=True)
