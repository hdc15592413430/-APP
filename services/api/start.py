import uvicorn

from app.settings import get_settings


if __name__ == "__main__":
    settings = get_settings()
    uvicorn.run(
        "run:app",
        host=settings.api_host,
        port=settings.api_port,
        reload=settings.app_env == "development",
    )
