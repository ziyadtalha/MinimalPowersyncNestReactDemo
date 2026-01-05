# PowerSync Role-Based Access --- Reference Guide

## Core Mental Model

**PowerSync does NOT support conditional logic inside a bucket.**\
**Role-based access is implemented by bucket existence, not SQL
branching.**

If a bucket's `parameters` query returns **0 rows**, that bucket **does
not exist**.

------------------------------------------------------------------------

## What PowerSync Does NOT Allow

-   OR conditions using different bucket parameters
-   Omitting bucket parameters in data queries
-   Using bucket parameters in expressions (`IS NULL`, functions, math)
-   Bucket parameters on both sides of `=`
-   Anchoring with tautologies
-   Role logic inside a single bucket

All of the above will fail validation.

------------------------------------------------------------------------

## What PowerSync Does Allow

-   Multiple buckets
-   Parameter gating (bucket exists or not)
-   Equality comparisons only:
    -   `column = bucket.param`
    -   `bucket.param = literal`
-   Literal parameters (`SELECT 1 AS is_admin`)
-   Automatic deduplication by primary key

------------------------------------------------------------------------

## Correct Pattern: One Role = One Bucket

### Example Domain

-   `User(id, role)` → `USER | ADMIN`
-   `Product(ownerId, …)`

------------------------------------------------------------------------

## Final Reference Implementation

``` yaml
sync_rules:
  content: |
    bucket_definitions:

      user_products:
        parameters: |
          SELECT id AS user_id
          FROM "User"
          WHERE
            id = token_parameters.user_id
            AND role = 'USER'

        data:
          - |
            SELECT *
            FROM "Product"
            WHERE "ownerId" = bucket.user_id


      admin_products:
        parameters: |
          SELECT 1 AS is_admin
          FROM "User"
          WHERE
            id = token_parameters.user_id
            AND role = 'ADMIN'

        data:
          - |
            SELECT *
            FROM "Product"
            WHERE bucket.is_admin = 1
```

------------------------------------------------------------------------

## Runtime Behavior

  User Role   user_products   admin_products   Result
  ----------- --------------- ---------------- --------------
  USER        Exists          Absent           Own products
  ADMIN       Absent          Exists           All products

------------------------------------------------------------------------

## Why the Dummy Parameter Works

PowerSync requires: - All bucket parameters to be referenced - Only
equality comparisons

`SELECT 1 AS is_admin` satisfies both requirements and enables
global/admin access safely.

------------------------------------------------------------------------

## Best Practices

-   Gate roles in `parameters`, not `data`
-   Use separate buckets per role
-   Use literal parameters for global access
-   Keep data queries static and simple

------------------------------------------------------------------------

## Final Takeaway

**PowerSync role-based access = bucket selection, not WHERE clauses.**
