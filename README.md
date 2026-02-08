# AWorld

**AWorld** is a web-based multiplayer 3D game. The backend is built with Python **FastAPI** and a native **WebSocket** endpoint for real-time updates. The frontend uses **Three.js** and vanilla JavaScript.

## Features

- Built with Python and FastAPI for the backend.
- Real-time multiplayer networking over WebSockets (`/ws`).
- Three.js-based 3D client.
- Modular code structure with separate directories for static files and templates.
- Includes a `game_design.md` file outlining the game's design concepts.
- Server health + metrics endpoint (`/health`).
- Physics config endpoint (`/physics`) for client/server tuning.
- Admin dashboard to monitor metrics and players (`/admin/dashboard`).

## Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/nalostta/aworld.git
   cd aworld
   ```
2. Set Up a Virtual Environment (Optional but Recommended)
  > python -m venv venv
  > source venv/bin/activate
# On Windows use: venv\Scripts\activate

3. Install Dependencies
  > pip install -r requirements.txt

## Usage
To run the application locally, use:
> uvicorn server:app --reload --port 8000

Open your web browser and visit http://localhost:8000 to access the game.

### Admin dashboard

- Visit `/admin/login` and enter the admin token.
- Configure via environment variables:
  - `ADMIN_TOKEN` (default: `test123`)
  - `ADMIN_SESSION_SECRET` (default: `dev-session-secret`)

Project Structure

aworld/     \
├── static/             # Static files (CSS, JS, images)       \
├── templates/          # HTML templates for the game UI       \
├── game_design.md      # Game design and documentation notes  \
├── requirements.txt    # Python package dependencies          \
└── server.py           # Main FastAPI application server

## Docker

The repository includes an Nginx + Uvicorn container setup:

- `start.sh` starts `uvicorn server:app` on port `8000` (internal)
- Nginx serves `/static/` and proxies to Uvicorn
- The container exposes port `8080`

Note: `compose.yaml` may need port mapping updates depending on how you run the container (the Docker image exposes `8080`).



Feel free to explore it if you're interested in extending or contributing to the game logic.

## Contributing
We welcome contributions from the community! To contribute:
- Fork the repository.
- Create a new branch for your feature or bugfix.
- Commit your changes and push to your fork.
- Open a Pull Request describing your changes.

- Please ensure code is well-commented and follows the project’s style guidelines.
