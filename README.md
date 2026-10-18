# Cinema Booking Management System

A full-stack web app for booking cinema tickets: a Node.js/Express backend, a SQL Server database and an HTML/CSS frontend.

## Features
- **Seat availability:** the seat map is read live from the database.
- **Bookings:** API endpoints that save the reservation and update the seat status.
- **Database safety:** parameterized SQL queries against SQL injection, and the booking is done in a transaction so the data stays consistent.
- **Frontend:** simple HTML/CSS pages connected to the backend.

## Tech stack
- **Backend:** Node.js, Express.js
- **Database:** Microsoft SQL Server Express (managed with SSMS)
- **Frontend:** HTML5, CSS3

## Requirements
- [Node.js](https://nodejs.org/)
- [SQL Server Express](https://www.microsoft.com/en-us/sql-server/sql-server-downloads) and SSMS

## Getting started
1. Clone the repository:
   ```bash
   git clone https://github.com/costilazar1703/cinema-app.git
   ```
