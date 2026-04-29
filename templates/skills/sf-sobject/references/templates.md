# sObject XML templates

Read this file in Steps 3–5 (CREATE mode only).

## Step 3: object-meta.xml

`force-app/main/default/objects/{ApiName}/{ApiName}.object-meta.xml`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<CustomObject xmlns="http://soap.sforce.com/2006/04/metadata">
    <label>Order</label>
    <pluralLabel>Orders</pluralLabel>
    <nameField>
        <label>Order Number</label>
        <type>AutoNumber</type>
        <displayFormat>ORD-{0000}</displayFormat>
        <startingNumber>1</startingNumber>
    </nameField>
    <sharingModel>Private</sharingModel>
    <deploymentStatus>Deployed</deploymentStatus>
    <description>Order management</description>
    <enableActivities>true</enableActivities>
    <enableReports>true</enableReports>
    <enableSearch>true</enableSearch>
    <enableBulkApi>true</enableBulkApi>
    <enableStreamingApi>true</enableStreamingApi>
    <enableHistory>false</enableHistory>
    <enableFeeds>false</enableFeeds>
</CustomObject>
```

For Text name field, replace `<nameField>` with:
```xml
<nameField>
    <label>Order Name</label>
    <type>Text</type>
</nameField>
```

## Step 4: default List View

`force-app/main/default/objects/{ApiName}/listViews/All.listView-meta.xml`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<ListView xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>All</fullName>
    <filterScope>Everything</filterScope>
    <label>All</label>
</ListView>
```

## Step 5: Tab (on request)

`force-app/main/default/tabs/{ApiName}.tab-meta.xml`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<CustomTab xmlns="http://soap.sforce.com/2006/04/metadata">
    <customObject>true</customObject>
    <motif>Custom20: Cash</motif>
    <label>Order</label>
</CustomTab>
```

Ask the user for an icon motif (built-in motif name like `Custom20: Cash`, `Custom53: Hands`, etc., or a Custom Image).
