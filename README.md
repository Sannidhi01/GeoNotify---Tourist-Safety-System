# GeoNotify - Tourist Safety System

GeoNotify is a role-based ai powered tourist safety platform with live geofencing, automatic alerts, weather-aware risk scoring, and rescue team monitoring.

It includes three working panels:

- `Admin` for creating and managing geofences
- `Tourist` for live location monitoring and safety insights
- `Rescue` for viewing active alerts and incident history

## Features

- Role-based login and registration
- Interactive map with geofence drawing and manual coordinate entry
- Admin panel for creating, editing, and deleting zones
- Tourist panel for live watch, current location, and movement simulation
- Rescue dashboard for active alerts and recent rescue events
- AI safety insights based on logs, weather, and time
- Weather-aware risk scoring
- Automatic rescue notification for danger and critical zones
- Notification history and alert tracking
- Optional zone auto-import from JSON

## Tech Stack

- Node.js + Express
- MongoDB + Mongoose
- JWT authentication
- Leaflet map UI
- Turf.js for geospatial checks
- Web Push, Twilio SMS, and Firebase Admin support
- Jest and Playwright for testing

## Prerequisites

- Node.js 18 or newer
- npm
- MongoDB running locally or a MongoDB Atlas connection string

## Installation

1. Clone the repository.
2. Install dependencies:

```bash
npm install
```

## Setup

1. Create a `.env` file in the project root.
2. Copy the variables from `.env.example` and update them for your environment.
3. Make sure `MONGODB_URI` is set.
4. Generate Web Push VAPID keys before starting the server if you want browser notifications:

```bash
npx web-push generate-vapid-keys
```

5. Copy the generated public and private keys into your `.env` file:

```env
VAPID_PUBLIC_KEY=your_public_key
VAPID_PRIVATE_KEY=your_private_key
```

## Running the App

Start the server:

```bash
npm start
```

## How To Use

### Tourist panel

- Register or log in as a tourist
- Start location watch
- Use `My Location` to center on your position
- Use `Simulate Movement` for testing
- Receive AI-based safety insights when available

### Admin panel

- Register or log in as an admin
- Click the map to draw geofence points
- Use manual coordinates if you want to paste locations directly
- Save geofences and manage safety levels
- set the time rules and severity levels

### Rescue panel

- Register or log in as a rescue user
- View active tourist alerts
- Check recent danger and rescue logs
- Monitor which zones need attention

## Default Roles

Users can register with one of these roles:

- `tourist`
- `admin`
- `rescue`

The actual dashboard shown after login depends on the role stored on the server.

## Project Structure

- `server/` - Express server, routes, middleware, models, and services
- `public/` - Frontend HTML, CSS, and JavaScript
- `data/` - Sample zone data for import
- `tests/` - Unit and E2E tests
