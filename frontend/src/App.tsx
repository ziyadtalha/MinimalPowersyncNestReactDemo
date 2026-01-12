import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import DashboardPage from './pages/DashboardPage';
import ProtectedRoute from './components/ProtectedRoute';
import './App.css';

import { PowerSyncDatabase, Schema, Table, Column, ColumnType } from '@powersync/web';
import { PowerSyncContext } from "@powersync/react";

// Define PowerSync schema
const schema = new Schema([
  new Table({
    name: 'Product',
    columns: [
      new Column({ name: 'id', type: ColumnType.TEXT }),
      new Column({ name: 'name', type: ColumnType.TEXT }),
      new Column({ name: 'price', type: ColumnType.REAL }),
      new Column({ name: 'description', type: ColumnType.TEXT }),
      new Column({ name: 'ownerId', type: ColumnType.TEXT }),
      new Column({ name: 'createdAt', type: ColumnType.TEXT }),
    ],
  }),
]);

// Inner component that has access to auth context
function AppContent() {
  const { isAuthenticated, token, isLoading } = useAuth();
  const [powerSync, setPowerSync] = React.useState<InstanceType<typeof PowerSyncDatabase> | null>(null);

  React.useEffect(() => {
    // Don't initialize if still loading auth state
    if (isLoading) return;

    // If not authenticated, disconnect and cleanup
    if (!isAuthenticated || !token) {
      if (powerSync) {
        console.log('User logged out, disconnecting PowerSync...');
        powerSync.disconnectAndClear().catch(console.error);
        setPowerSync(null);
      }
      return;
    }

    // Initialize PowerSync with current token
    const initPowerSync = async () => {
      const url = import.meta.env.VITE_POWERSYNC_URL || 'http://localhost:8080';
      const backendUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';

      // Create the backend connector
      const connector = {
        fetchCredentials: async () => {
          // Always use the latest token from the closure
          const currentToken = token;
          if (!currentToken) {
            throw new Error('No token available');
          }
          return {
            endpoint: url,
            token: currentToken,
          };
        },
        uploadData: async (database: InstanceType<typeof PowerSyncDatabase>) => {
          // Get the next batch of local changes to upload
          const transaction = await database.getNextCrudTransaction();

          if (!transaction) {
            return; // No pending changes
          }

          console.log('Uploading transaction with', transaction.crud.length, 'operations');

          try {
            // Send the batch to our backend
            const response = await fetch(`${backendUrl}/powersync/upload`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
              },
              body: JSON.stringify(transaction),
            });

            if (!response.ok) {
              const errorText = await response.text();
              console.error('Upload failed:', response.status, errorText);
              
              // 5xx errors are transient - throw to retry
              if (response.status >= 500) {
                throw new Error(`Server error: ${response.status}`);
              }
              
              // 4xx errors are likely fatal - complete transaction to discard
              console.warn('Client error during upload - discarding transaction:', errorText);
              await transaction.complete();
              return;
            }

            const result = await response.json();
            console.log('Upload successful:', result);

            // Mark transaction as complete
            await transaction.complete();
          } catch (error: unknown) {
            console.error('Error uploading data:', error);
            
            // Network errors and 5xx errors will be retried automatically by PowerSync
            // by throwing the error here
            throw error;
          }
        },
      };

      const db = new PowerSyncDatabase({
        schema,
        database: {
          dbFilename: 'powersync.db',
        },
      });

      console.log('Creating PowerSync database instance...', db);

      console.log('Initializing PowerSync for authenticated user...');
      await db.init();
      await db.connect(connector);
      console.log('PowerSync connected successfully');
      
      setPowerSync(db);
    };

    // If token changed and we already have a PowerSync instance, reconnect
    if (powerSync) {
      console.log('Token changed, reconnecting PowerSync...');
      powerSync.disconnectAndClear()
        .then(() => initPowerSync())
        .catch(console.error);
    } else {
      // First time initialization
      initPowerSync().catch(console.error);
    }

    // Cleanup on unmount
    return () => {
      if (powerSync) {
        powerSync.disconnectAndClear().catch(console.error);
      }
    };
  }, [isAuthenticated, token, isLoading]);

  return (
    <PowerSyncContext.Provider value={powerSync}>
      <Router>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />

          <Route element={<ProtectedRoute />}>
            <Route path="/dashboard" element={<DashboardPage />} />
          </Route>

          <Route path="/" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </Router>
    </PowerSyncContext.Provider>
  );
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;