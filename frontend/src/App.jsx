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
import DashboardPage from "./pages/DashboardPage";
import FarmerDashboard from "./pages/FarmerDashboard";
import BuyerDashboard from "./pages/BuyerDashboard";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />

        <Route path="/login" element={<AuthPage />} />

        <Route path="/register" element={<AuthPage />} />

        <Route
          path="/farmer/dashboard"
          element={<FarmerDashboard />}
        />

        <Route
          path="/buyer/dashboard"
          element={<BuyerDashboard />}
        />

        <Route
          path="/admin/dashboard"
          element={<DashboardPage />}
        />

        <Route
          path="/dashboard"
          element={
            <Navigate to="/farmer/dashboard" replace />
          }
        />

        <Route
          path="*"
          element={
            <main className="wrap section">
              <h1>Page not found</h1>

              <Link
                className="btn green space-top"
                to="/"
              >
                Back to Home
              </Link>
            </main>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}