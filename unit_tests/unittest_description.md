# Unit Test Descriptions for AWorld

**Note:** The unit-testing script should output a checklist of all the tests executed and their pass/fail status after running the tests. This checklist should appear in the terminal or output window immediately following test execution.

This document summarizes the behaviors tested by the unit tests in the `unit_tests` directory.

---

## test_user_interactions.py

**1. Player Join Event**
- Simulates a player joining the game via websocket by sending a `player_join` event with a name and color.
- For testing purposes, the player name is set to "Unit_Tester" and the color is set to "#FFFFFF".
- Verifies that the server responds with either a `global_state_update` or `player_count_update` event, confirming the player was added.

**2. Player Movement Event**
- Simulates a player joining and then sending a movement event (e.g., moving forward) via websocket.
- Checks that the server responds with a `global_state_update` event, indicating the move was processed.

**3. Chat Message Event**
- Simulates a player joining and then sending a `chat_message` event via websocket.
- Verifies that the server responds with either a `global_state_update` or `chat_message` event, confirming chat functionality.

**4. Object Interaction Events**
- Simulates a player joining and then performing a sequence of object interactions:
- Checks that the server responds with a `global_state_update` event, confirming object manipulation is handled.

**5. Portal Usage Event**
- Simulates a player joining and then using a portal by sending a `use_portal` event via websocket.
- Verifies that the server responds with a `global_state_update` event, confirming portal usage is processed.

**6. Wall Display Update (REST API)**
- Sends a POST request to the `/api/wall_display` endpoint to update the wall display content.
- Verifies that the server responds with a status of `ok`, confirming the REST endpoint works.

---

## __init__.py
- Marks the `unit_tests` directory as a Python package for test discovery.

## conftest.py
- Placeholder for pytest configuration and fixtures (currently empty, but can be extended for shared fixtures or setup logic).

---

Each test simulates user or system actions as they would occur in the live application, ensuring core gameplay and interaction mechanics are validated through the backend API and websocket interface.

**Checklist Output Location:**
- After you run the unit-testing script (e.g., via pytest or a custom runner), a checklist should be printed summarizing each test executed and whether it passed or failed. This should be visible at the end of the test output in your terminal or CI logs.
