import React from "react";

import {
  BrowserRouter,
  Link,
  Navigate,
  Route,
  Routes,
} from "react-router-dom";

import LandingPage from "./pages/LandingPage";
import AuthPage from "./pages/AuthPage";

import FarmerDashboard from "./pages/FarmerDashboard";
import BuyerDashboard from "./pages/BuyerDashboard";
import AdminDashboard from "./pages/AdminDashboard";

function NotFoundPage() {
  return (
    <main
      className="wrap section"
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "16px",
        padding: "24px",
        background: "#faf7ef",
        color: "#003d2d",
        textAlign: "center",
      }}
    >
      <h1>404 — Page not found</h1>

      <p>The page you are looking for is not available.</p>

      <Link
        to="/"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          minWidth: "138px",
          minHeight: "36px",
          padding: "8px 16px",
          borderRadius: "9px",
          background: "#005536",
          color: "#ffffff",
          textDecoration: "none",
          fontWeight: 700,
        }}
      >
        Back to Home
      </Link>
    </main>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public home page */}
        <Route
          path="/"
          element={<LandingPage />}
        />

        {/* Authentication */}
        <Route
          path="/login"
          element={<AuthPage />}
        />

        <Route
          path="/register"
          element={<AuthPage />}
        />

        {/* Farmer dashboard */}
        <Route
          path="/farmer/dashboard"
          element={<FarmerDashboard />}
        />

        {/* Buyer dashboard */}
        <Route
          path="/buyer/dashboard"
          element={<BuyerDashboard />}
        />

        {/* Admin dashboard */}
        <Route
          path="/admin/dashboard"
          element={<AdminDashboard />}
        />

        {/* Existing dashboard redirect */}
        <Route
          path="/dashboard"
          element={
            <Navigate
              to="/farmer/dashboard"
              replace
            />
          }
        />

        {/* Unknown routes */}
        <Route
          path="*"
          element={<NotFoundPage />}
        />
      </Routes>
    </BrowserRouter>
  );
}