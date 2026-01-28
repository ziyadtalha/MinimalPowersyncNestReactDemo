import { useAuth } from '../context/AuthContext';
import { usePowerSync, useQuery, useStatus } from '@powersync/react';
//import client from '../api/client';
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
    const powerSync = usePowerSync();
    const status = useStatus();
    const { data: products, isLoading, error } = useQuery(
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
            // Force local insert by throwing error before API call
            throw new Error('FORCE_LOCAL_INSERT');
            
            // Uncomment to use backend API instead of local insert
            // await client.post('/products', {
            //     name,
            //     price: Number(price),
            //     description: description || null,
            // });
            // setName(''); setPrice(''); setDescription('');
        } catch (err: unknown) {
            console.error(err);

            // Check if this is our forced local insert
            if (err instanceof Error && err.message === 'FORCE_LOCAL_INSERT') {
                if (!powerSync) {
                    alert('PowerSync not available for local insert');
                    setCreating(false);
                    return;
                }

                console.log('Attempting local insert via PowerSync...', user);

                try {
                    const res = await powerSync.execute(
                        /* sql */ `
                        INSERT INTO Product (id, name, price, description, ownerId, createdAt)
                        VALUES (uuid(), ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                    `,
                        [name, Number(price), description || null, user?.id]
                    );

                    console.log('Local insert result:', res);
                    // Clear form after successful local insert
                    setName('');
                    setPrice('');
                    setDescription('');
                } catch (e2) {
                    console.error('Local insert failed', e2);
                    alert('Local insert failed');
                }
                setCreating(false);
                return;
            }

            // For other errors, show alert
            alert('Error creating product');
            setCreating(false);
        }
    };

    const updateProduct = async (p: Product) => {
        const newName = window.prompt('New name', p.name) ?? p.name;
        const newPriceRaw = window.prompt('New price', String(p.price));
        const newPrice = newPriceRaw ? Number(newPriceRaw) : p.price;
        const newDescription = window.prompt('New description', p.description ?? '') ?? p.description;
        try {
            // Force local update by throwing error before API call
            throw new Error('FORCE_LOCAL_UPDATE');
            
            // Uncomment to use backend API instead of local update
            // await client.patch(`/products/${p.id}`, {
            //     name: newName,
            //     price: newPrice,
            //     description: newDescription,
            // });
        } catch (err: unknown) {
            console.error(err);

            // Check if this is our forced local update
            if (err instanceof Error && err.message === 'FORCE_LOCAL_UPDATE') {
                if (!powerSync) {
                    alert('PowerSync not available for local update');
                    return;
                }

                console.log('Attempting local update via PowerSync...', p.id);

                try {
                    const res = await powerSync.execute(
                        /* sql */ `
                        UPDATE Product
                        SET name = ?, price = ?, description = ?
                        WHERE id = ?
                    `,
                        [newName, newPrice, newDescription, p.id]
                    );

                    console.log('Local update result:', res);
                } catch (e2) {
                    console.error('Local update failed', e2);
                    alert('Local update failed');
                }
                return;
            }

            // For other errors, show alert
            alert('Error updating product');
        }
    };

    const deleteProduct = async (p: Product) => {
        if (!window.confirm(`Delete product "${p.name}"?`)) return;
        try {
            // Force local delete by throwing error before API call
            throw new Error('FORCE_LOCAL_DELETE');
            
            // Uncomment to use backend API instead of local delete
            // await client.delete(`/products/${p.id}`);
        } catch (err: unknown) {
            console.error(err);

            // Check if this is our forced local delete
            if (err instanceof Error && err.message === 'FORCE_LOCAL_DELETE') {
                if (!powerSync) {
                    alert('PowerSync not available for local delete');
                    return;
                }

                console.log('Attempting local delete via PowerSync...', p.id);

                try {
                    const res = await powerSync.execute(
                        /* sql */ `
                        DELETE FROM Product
                        WHERE id = ?
                    `,
                        [p.id]
                    );

                    console.log('Local delete result:', res);
                } catch (e2) {
                    console.error('Local delete failed', e2);
                    alert('Local delete failed');
                }
                return;
            }

            // For other errors, show alert
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
