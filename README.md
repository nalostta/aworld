# AWorld

**AWorld** is a web-based game project developed using Python and Flask. It aims to provide an interactive gaming experience through a browser interface.

## Features

- Built with Python and Flask for the backend.
- Utilizes HTML, CSS, and JavaScript for the frontend.
- Modular code structure with separate directories for static files and templates.
- Includes a `game_design.md` file outlining the game's design concepts.

## Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/nalostta/aworld.git
   cd aworld
2. Set Up a Virtual Environment (Optional but Recommended)
  > python -m venv venv
  > source venv/bin/activate
# On Windows use: venv\Scripts\activate

3. Install Dependencies
  > pip install -r requirements.txt

## Usage
To run the application locally, use:
> python server.py
# Alternatively, try the experimental FastAPI server:
> python server_fastapi.py

Open your web browser and visit http://localhost:5001 to access the game.

Project Structure

aworld/     \
├── static/             # Static files (CSS, JS, images)       \
├── templates/          # HTML templates for the game UI       \
├── game_design.md      # Game design and documentation notes  \
├── requirements.txt    # Python package dependencies          \
└── server.py           # Main Flask application server
├── server_fastapi.py   # Experimental FastAPI port



Feel free to explore it if you're interested in extending or contributing to the game logic.

## Contributing
We welcome contributions from the community! To contribute:
- Fork the repository.
- Create a new branch for your feature or bugfix.
- Commit your changes and push to your fork.
- Open a Pull Request describing your changes.

- Please ensure code is well-commented and follows the project’s style guidelines.
