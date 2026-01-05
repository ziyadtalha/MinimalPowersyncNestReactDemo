import { useAuth } from '../context/AuthContext';
import { usePowerSync, useQuery, useStatus } from '@powersync/react';
import client from '../api/client';
import React from 'react';

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
    const { user } = useAuth();
    const status = useStatus();
    const { data: products, isLoading, error } = useQuery<Product>(
        'SELECT * FROM Product',
        []
    );

    const [creating, setCreating] = React.useState(false);
    const [name, setName] = React.useState('');
    const [price, setPrice] = React.useState<number | ''>('');
    const [description, setDescription] = React.useState('');

    const createProduct = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name || price === '') return;
        setCreating(true);
        try {
            await client.post('/products', {
                name,
                price: Number(price),
                description: description || null,
            });
            setName(''); setPrice(''); setDescription('');
        } catch (err) {
            console.error(err);
            alert('Error creating product');
        } finally {
            setCreating(false);
        }
    };

    const updateProduct = async (p: Product) => {
        const newName = window.prompt('New name', p.name) ?? p.name;
        const newPriceRaw = window.prompt('New price', String(p.price));
        const newPrice = newPriceRaw ? Number(newPriceRaw) : p.price;
        const newDescription = window.prompt('New description', p.description ?? '') ?? p.description;
        try {
            await client.patch(`/products/${p.id}`, {
                name: newName,
                price: newPrice,
                description: newDescription,
            });
        } catch (err) {
            console.error(err);
            alert('Error updating product');
        }
    };

    const deleteProduct = async (p: Product) => {
        if (!window.confirm(`Delete product "${p.name}"?`)) return;
        try {
            await client.delete(`/products/${p.id}`);
        } catch (err) {
            console.error(err);
            alert('Error deleting product');
        }
    };

    React.useEffect(() => {
        // Log the tables/data received from PowerSync
        console.log('PowerSync status:', status);
    }, [status]);

    React.useEffect(() => {
        console.log('PowerSync products table update:', products);
    }, [products]);

    return (
        <>
            <div style={{ marginBottom: '20px', fontSize: '14px', color: '#666' }}>
                <div>
                    PowerSync Status: {status.connected ? '✓ Connected' : '✗ Disconnected'}
                    {status.hasSynced && ' | Synced'}
                </div>
            </div>

            <section style={{ marginTop: 20 }}>
                <h2>Create Product</h2>
                <form onSubmit={createProduct} style={{ marginBottom: 20 }}>
                    <input placeholder="Name" value={name} onChange={e => setName(e.target.value)} required style={{ marginRight: 8 }} />
                    <input placeholder="Price" value={price as any} onChange={e => setPrice(e.target.value === '' ? '' : Number(e.target.value))} required style={{ marginRight: 8, width: 100 }} />
                    <input placeholder="Description" value={description} onChange={e => setDescription(e.target.value)} style={{ marginRight: 8 }} />
                    <button type="submit" disabled={creating}>{creating ? 'Creating…' : 'Create'}</button>
                </form>

                {isLoading && <p>Loading products…</p>}
                {error && <p style={{ color: 'red' }}>Error: {error.message}</p>}
                {!isLoading && !error && (!products || products.length === 0) && <p>No products found.</p>}

                {!isLoading && !error && products && (
                    <>
                        {user?.role === 'ADMIN' ? (
                            <>
                                <h2>My Products (Admin)</h2>
                                <ul>
                                    {products
                                        .filter(p => p.ownerId === user.id)
                                        .map(p => (
                                            <li key={p.id} style={{ marginBottom: 10 }}>
                                                <strong>{p.name}</strong> — ${p.price.toFixed(2)}
                                                <div style={{ fontSize: 12, color: '#666' }}>{p.description}</div>
                                                <div style={{ marginTop: 6 }}>
                                                    <button onClick={() => updateProduct(p)} style={{ marginRight: 8 }}>Edit</button>
                                                    <button onClick={() => deleteProduct(p)} style={{ background: '#dc3545', color: 'white' }}>Delete</button>
                                                </div>
                                            </li>
                                        ))}
                                </ul>

                                <h2>Other Users' Products</h2>
                                <ul>
                                    {products
                                        .filter(p => p.ownerId !== user.id)
                                        .map(p => (
                                            <li key={p.id} style={{ marginBottom: 10 }}>
                                                <strong>{p.name}</strong> — ${p.price.toFixed(2)}
                                                <div style={{ fontSize: 12, color: '#666' }}>{p.description}</div>
                                                <div style={{ fontSize: 12, color: '#444' }}>Owner: {p.ownerId}</div>
                                            </li>
                                        ))}
                                </ul>
                            </>
                        ) : (
                            <>
                                <h2>Your Products</h2>
                                <ul>
                                    {products.map((p) => (
                                        <li key={p.id} style={{ marginBottom: 10 }}>
                                            <strong>{p.name}</strong> — ${p.price.toFixed(2)}
                                            <div style={{ fontSize: 12, color: '#666' }}>{p.description}</div>
                                            <div style={{ marginTop: 6 }}>
                                                <button onClick={() => updateProduct(p)} style={{ marginRight: 8 }}>Edit</button>
                                                <button onClick={() => deleteProduct(p)} style={{ background: '#dc3545', color: 'white' }}>Delete</button>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            </>
                        )}
                    </>
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
