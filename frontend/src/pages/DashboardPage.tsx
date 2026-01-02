import { useAuth } from '../context/AuthContext';
import { usePowerSync, useQuery, useStatus } from '@powersync/react';

type Product = {
    id: string;
    name: string;
    price: number;
    description?: string | null;
    ownerId: string;
    createdAt: string;
};

// Component that only renders when PowerSync is available
const ProductsList = () => {
    const status = useStatus();
    const { data: products, isLoading, error } = useQuery<Product>(
        'SELECT * FROM Product',
        []
    );

    return (
        <>
            <div style={{ marginBottom: '20px', fontSize: '14px', color: '#666' }}>
                <div>
                    PowerSync Status: {status.connected ? '✓ Connected' : '✗ Disconnected'}
                    {status.hasSynced && ' | Synced'}
                </div>
            </div>

            <section style={{ marginTop: 20 }}>
                <h2>Your Products</h2>
                {isLoading && <p>Loading products…</p>}
                {error && <p style={{ color: 'red' }}>Error: {error.message}</p>}
                {!isLoading && !error && products.length === 0 && <p>No products found.</p>}
                {!isLoading && !error && products.length > 0 && (
                    <ul>
                        {products.map((p) => (
                            <li key={p.id} style={{ marginBottom: 10 }}>
                                <strong>{p.name}</strong> — ${p.price.toFixed(2)}
                                <div style={{ fontSize: 12, color: '#666' }}>{p.description}</div>
                            </li>
                        ))}
                    </ul>
                )}
            </section>
        </>
    );
};

const DashboardPage = () => {
    const { user, logout } = useAuth();
    const powerSync = usePowerSync();

    return (
        <div style={{ padding: '20px' }}>
            <h1>Dashboard</h1>
            <p>Welcome, {user?.email}!</p>

            <button
                onClick={logout}
                style={{ padding: '10px 20px', backgroundColor: '#dc3545', color: 'white', border: 'none', cursor: 'pointer' }}
            >
                Logout
            </button>

            {!powerSync ? (
                <p style={{ marginTop: 20 }}>Initializing PowerSync...</p>
            ) : (
                <ProductsList />
            )}
        </div>
    );
};

export default DashboardPage;
