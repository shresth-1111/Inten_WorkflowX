# WorkFlowX — Technical Report Diagrams

---

## Figure 1: Entity-Relationship (ER) Diagram

```mermaid
erDiagram
    users {
        INT id PK "AUTO_INCREMENT"
        VARCHAR email UK "UNIQUE NOT NULL"
        VARCHAR password "NOT NULL"
        ENUM role "developer | admin"
    }

    projects {
        INT id PK "AUTO_INCREMENT"
        VARCHAR name "NOT NULL"
        TEXT description
        VARCHAR creator "NOT NULL"
    }

    project_members {
        INT project_id PK, FK "REFERENCES projects(id)"
        VARCHAR user_email PK "Composite PK"
    }

    tasks {
        INT id PK "AUTO_INCREMENT"
        INT project_id FK "REFERENCES projects(id)"
        VARCHAR title "NOT NULL"
        TEXT description
        VARCHAR priority
        ENUM status "todo | progress | done"
        VARCHAR last_modified_by
    }

    users ||--o{ project_members : "is assigned to"
    projects ||--o{ project_members : "has members"
    projects ||--o{ tasks : "contains"
```

---

## Figure 2: Decoupled Client-Server Core System Architecture Model

```mermaid
flowchart LR
    subgraph CLIENT["Client Browser UI"]
        direction TB
        UI["HTML5 / Tailwind CSS\nDark Mode Interface"]
        FETCH["Fetch API Engine\nAsync HTTP Dispatcher"]
        UI --> FETCH
    end

    subgraph SERVER["Express.js REST Routing Gateway\nPort 5000"]
        direction TB
        CORS["CORS Middleware"]
        JSON["express.json() Parser"]
        ROUTES["API Route Handlers\n/auth /admin /projects /tasks"]
        CORS --> JSON --> ROUTES
    end

    subgraph DATABASE["MySQL Storage Cluster"]
        direction TB
        POOL["mysql2/promise\nConnection Pool\nconnectionLimit: 10"]
        MYSQL[("teslonic_workflowx\nMySQL 8.x Database")]
        POOL --> MYSQL
    end

    FETCH -- "POST /api/auth/login\nPOST /api/admin/onboard\nPOST /api/projects/create\nGET  /api/projects/fetch/:email/:role\nPOST /api/tasks/create\nPATCH /api/tasks/:taskId/transition\nGET  /api/projects/:projectId/tasks" --> CORS

    ROUTES -- "Parameterized SQL Queries\nTransaction Blocks\nINNER JOINs" --> POOL

    MYSQL -- "Result Sets\nInsert IDs\nAffected Rows" --> ROUTES
    ROUTES -- "JSON Response\n{ success, data }" --> FETCH
```

---

## Figure 3: State Transition Audit Trail Workflow Logic

```mermaid
flowchart TD
    A["Developer selects new status\nfrom task card dropdown"] --> B{"Browser Confirmation\nDialog Prompt:\nAre you sure you want to\ntransition this scope?"}

    B -- "User clicks Cancel" --> C["Revert dropdown\nto previous status value"]
    C --> D["Operation Terminated\nNo API call fired"]

    B -- "User clicks OK" --> E["Execute Fetch PATCH\n/api/tasks/:taskId/transition\nPayload: { status, userEmail }"]

    E --> F{"Server Response\nHTTP Status Check"}

    F -- "Failure / Network Error" --> G["Alert: Server connection failed\nRevert dropdown to previous state"]
    G --> D

    F -- "success: true" --> H["Backend executes atomic SQL:\nUPDATE tasks\nSET status = ?,\nlast_modified_by = ?\nWHERE id = ?"]

    H --> I["Update local state array:\ntask.status = newStatus\ntask.last_modified_by = userEmail"]

    I --> J["Re-render Kanban board:\nMove card to target column"]

    J --> K["Render audit stamp\nat card footer:\nLast modified by: user_email"]
```
