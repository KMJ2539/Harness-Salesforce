// Seed handler in the demo project. The /sf-apex walkthrough modifies this
// file (MODIFY mode) to exercise the modify-approval gate. It is intentionally
// minimal — it has no FLS guards, which the security reviewer flags as [H1]
// during the 5-persona review in Step 03 of WALKTHROUGH.md.
public with sharing class OrderHandler {

    public static void afterInsert(List<Order__c> newOrders) {
        for (Order__c o : newOrders) {
            if (o.Amount__c != null && o.Amount__c > 1000) {
                o.Status__c = 'High Value';
            }
        }
        update newOrders;
    }
}
