---
name: sf-field
description: Add or modify fields on an SObject (standard/custom) with ensure semantics. Create if no field with the same API name exists, modify after diff approval if it does. Supports every field type (Text, Number, Picklist, Lookup, Master-Detail, Formula, Roll-up Summary, etc.). Run sf-context-explorer for impact analysis before changes. Use for requests like "add a field", "change Account.Status label", "add a picklist value", "create a Lookup field".
---

# /sf-field

Handle SObject fields in **ensure mode** — create if no field with the same API name exists, modify if it does. Supports both standard and custom objects.

## Step 0: Invocation mode detection

If the caller (`/sf-feature`, etc.) passes a feature design.md path + artifact ID, this is a **delegated mode candidate**. Verify with the sentinel:
```bash
node .claude/hooks/_lib/check-delegated-token.js <design-md-path> <artifact-id>
```
exit 0 → delegated mode confirmed (load the matching field artifact section in design.md — object, API name, type, length/picklist values, etc. — skip the Step 1 question battery and start from Step 2 context analysis; on completion/failure the caller updates status via dispatch-state-cli).
exit 1 → standalone mode (start from Step 0.3 below).

## Step 0.3: Feature context gate (required when entering standalone)

```bash
node .claude/hooks/_lib/check-feature-context.js
```

If `has_active_feature: true` and a pending artifact of type=`field` exists, propose a redirect via AskUserQuestion: `[r]` `/sf-feature` / `[s]` reason then stub (`type: field, standalone_override: true`) / `[a]` abort. If no match, pass through. Bypass: `HARNESS_SF_SKIP_FEATURE_GATE=1`.

## Step 1: Intent clarification

**Required information**
- Target object (e.g. `Account`, `Order__c`)
- Label (Korean OK)
- API name (auto-suggest: derived from label, `__c` suffix is automatic)
- Field type (see list below)
- Description
- Help text (shown to users)
- Required?
- Unique? (where applicable)
- External ID? (where applicable)

**Field type list**
| Type | Extra info |
|---|---|
| Text | length (max 255) |
| Long Text Area | length (max 131,072), visible lines |
| Rich Text Area | length, lines |
| Text Area | (multi-line, fixed 255) |
| Email | — |
| Phone | — |
| URL | — |
| Number | precision, scale |
| Currency | precision, scale |
| Percent | precision, scale |
| Date | — |
| Date/Time | — |
| Time | — |
| Checkbox | default value |
| Picklist | values, restricted, controlling field |
| Multi-Select Picklist | values, visible lines |
| Lookup | referenceTo, deleteConstraint (SetNull/Restrict/Cascade) |
| Master-Detail | referenceTo, sharing settings, reparenting |
| External Lookup | external object |
| Formula | returnType, formula expression |
| Roll-up Summary | summarizedField, aggregation, filter |
| Auto Number | displayFormat, startingNumber |
| Geolocation | scale, displayLocationInDecimal |
| Encrypted Text | maskType, length |

## Step 2: Context analysis (required)

**Invoke `sf-context-explorer` via the `Agent` tool** — pass the object and the field-change intent.

Specifically check the following impact areas:
- Whether triggers/Flows on the object will reference this field
- Whether Validation Rules need to be added
- Whether page layouts, search layouts, list views need updating
- Whether Permission Set FLS grants are needed
- Whether Report Types need updating
- If LWC/Aura uses this object, additional imports needed

⚠️ **When adding to a standard object**: strong warning. Confirm no conflict with standard fields.

## Step 2.5: Mode decision (CREATE vs MODIFY)

Check whether the field file exists via `Glob force-app/main/default/objects/{ObjectApiName}/fields/{FieldApiName}.field-meta.xml`:

**Absent → CREATE mode**: continue from Step 3.

**Present → MODIFY mode**:
1. `Read` the existing `.field-meta.xml`.
2. The following changes have **large data impact — strong warning + explicit approval required**:
   - `type` change (e.g. Text → Picklist, Number → Currency) — risk of data loss/conversion
   - `length` shrink (truncation) / `precision`·`scale` shrink
   - `required` false → true (existing NULL records break)
   - `unique` false → true (fails if duplicates exist)
   - Master-Detail `referenceTo` change (reparenting policy)
   - Switching Picklist `restricted` to true (must verify existing values comply)
   - Picklist value deletion (existing records' values become inactive)
3. The following are safe changes:
   - `label`, `description`, `inlineHelpText` updates
   - Picklist value **additions** (not deletions)
   - `length` expansion, `precision` expansion
4. **User approval gate**: present per-item risk and diff → confirm before write.
5. **Issue approval sentinel (required)**: immediately after the user's approval, and before Edit/Write, issue:
   ```bash
   node .claude/hooks/_lib/issue-modify-approval.js force-app/.../objects/{ObjectApiName}/fields/{FieldApiName}.field-meta.xml
   ```
   The `pre-modify-approval-gate.js` hook blocks without a sentinel (TTL 30 min + git HEAD match). Issuing a sentinel without user approval is a policy violation.
6. Re-evaluate impact on LWC/Apex/Flow/Validation Rule that reference this field (Step 2 results).

## Step 3: Generate field metadata

**`force-app/main/default/objects/{ObjectApiName}/fields/{FieldApiName}.field-meta.xml`**

Examples by type:

**Text**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>Status__c</fullName>
    <label>Status</label>
    <type>Text</type>
    <length>50</length>
    <required>false</required>
    <unique>false</unique>
    <description>Current status</description>
    <inlineHelpText>Enter the current status of this record</inlineHelpText>
</CustomField>
```

**Picklist**
```xml
<type>Picklist</type>
<valueSet>
    <restricted>true</restricted>
    <valueSetDefinition>
        <sorted>false</sorted>
        <value>
            <fullName>Active</fullName>
            <default>true</default>
            <label>Active</label>
        </value>
        <value>
            <fullName>Inactive</fullName>
            <default>false</default>
            <label>Inactive</label>
        </value>
    </valueSetDefinition>
</valueSet>
```
**Recommended**: separate Global Value Set (reusable).

**Lookup**
```xml
<type>Lookup</type>
<referenceTo>Contact</referenceTo>
<relationshipLabel>Orders</relationshipLabel>
<relationshipName>Orders</relationshipName>
<deleteConstraint>SetNull</deleteConstraint>
```

**Master-Detail**
```xml
<type>MasterDetail</type>
<referenceTo>Account</referenceTo>
<relationshipLabel>Orders</relationshipLabel>
<relationshipName>Orders</relationshipName>
<reparentableMasterDetail>false</reparentableMasterDetail>
<writeRequiresMasterRead>false</writeRequiresMasterRead>
```
⚠️ Adding Master-Detail: child sharing model becomes "Controlled by Parent". Warn about impact on existing data.

**Formula**
```xml
<type>Text</type>  <!-- or returnType -->
<formula>IF(ISBLANK(Status__c), "Unknown", Status__c)</formula>
<formulaTreatBlanksAs>BlankAsBlank</formulaTreatBlanksAs>
```

**Roll-up Summary** (only on Master-Detail children)
```xml
<type>Summary</type>
<summarizedField>Order__c.Amount__c</summarizedField>
<summaryForeignKey>Order__c.Account__c</summaryForeignKey>
<summaryOperation>sum</summaryOperation>
```

## Step 4: Permission grant guidance

The skill creates only the field — separate FLS — **recommend updating a Permission Set**:
```xml
<!-- Add to PermissionSet file -->
<fieldPermissions>
    <field>ObjectApiName.FieldApiName__c</field>
    <readable>true</readable>
    <editable>true</editable>
</fieldPermissions>
```
Ask which PS users to target, then auto-update or guide manually.

## Step 5: Follow-up impact recommendations
Based on context-explorer results:

- If a trigger uses this field → "trigger modification required. Use `/sf-apex` or edit directly"
- If a Flow needs updating → "Flow Builder UI or direct metadata edit"
- If LWC schema imports must be added → list affected components
- For Page Layout / Lightning Page exposure → separate work needed
- For Report Type custom field exposure → guide

## Step 6: Report
- Created files (path)
- Field info summary
- Impact-area inventory (context-explorer results)
- Recommended follow-ups (priority 1–5)

## AskUserQuestion policy
- Target object, label, field type (required)
- Type-specific extra parameters (length, picklist values, etc.)
- Required, Unique, External ID
- description, help text — explicit values recommended (manageability)

## Antipattern rejection
- Reject creation without description — debugging cost in the future
- Reject Picklist unrestricted + many user-input combination (data quality disaster)
- Strong warning when adding Master-Detail with existing data
- When adding to a standard object, explicitly call out sharing/profile impact

## Artifact locations
- `force-app/main/default/objects/{ObjectApiName}/fields/{FieldApiName}.field-meta.xml`
- (optional) PermissionSet update
