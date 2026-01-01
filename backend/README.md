# Minimal Backend (NestJS + Prisma + PostgreSQL)

A minimal NestJS backend with JWT authentication, Prisma ORM, and PostgreSQL.

## Setup

1. **Install dependencies:**

```powershell
cd backend
npm install
```

2. **Configure environment:**

Copy `.env.example` to `.env` and update the values:

```powershell
cp .env.example .env
```

Update `DATABASE_URL` to match your PostgreSQL instance and set a secure `JWT_SECRET`.

3. **Generate Prisma Client and run migrations:**

```powershell
npx prisma generate
npx prisma migrate dev --name init
```

4. **Start the development server:**

```powershell
npm run start:dev
```

The API will be available at http://localhost:3000

## API Endpoints

### Authentication
- **POST** `/auth/register` - Register a new user
  - Body: `{ "email": "user@example.com", "password": "Password123!" }`
- **POST** `/auth/login` - Login user
  - Body: `{ "email": "user@example.com", "password": "Password123!" }`
- **GET** `/auth/profile` - Get current user profile (requires Bearer token)

### Other
- **GET** `/` - Health check

## Swagger Documentation

Interactive API documentation is available at: http://localhost:3000/api

## Features

- ✅ NestJS framework
- ✅ Prisma ORM with PostgreSQL
- ✅ JWT authentication with bcrypt password hashing
- ✅ Global JWT guard with @Public() decorator for public routes
- ✅ Request validation with class-validator
- ✅ Swagger/OpenAPI documentation
- ✅ CORS enabled

## Scripts

- `npm run start:dev` - Start in watch mode
- `npm run build` - Build for production
- `npm run start:prod` - Run production build
- `npx prisma studio` - Open Prisma Studio (database GUI)
- `npx prisma migrate dev` - Create and apply migrations
