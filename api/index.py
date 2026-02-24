from backend.main import create_app


# Expose both prefixed and unprefixed routes to tolerate Vercel's internal ASGI
# path handling for /api serverless functions.
app = create_app(api_prefixes=("", "/api"))
