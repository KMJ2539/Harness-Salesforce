public with sharing class AccountService {
    public static List<Account> findActive(String name) {
        if (!Schema.sObjectType.Account.isAccessible()) {
            throw new System.NoAccessException();
        }
        String safeName = String.escapeSingleQuotes(name);
        String soql = 'SELECT Id, Name FROM Account WHERE Name = \'' + safeName + '\'';
        return Database.query(soql);
    }
}
