// INTENTIONALLY VULNERABLE — harness-sf test fixture only.
// NOT for deployment. See expected.json `intentionallyVulnerable: true`.
public class UnsafeAccountSvc {
    public static List<Account> search(String name) {
        String soql = 'SELECT Id, Name FROM Account WHERE Name = \'' + name + '\'';
        return Database.query(soql);
    }
}
