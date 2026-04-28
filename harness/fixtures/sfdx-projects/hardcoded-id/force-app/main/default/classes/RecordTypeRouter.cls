// INTENTIONALLY VULNERABLE — harness-sf test fixture only.
// NOT for deployment. Hardcoded RecordType IDs.
public with sharing class RecordTypeRouter {
    private static final Id BIZ_RT = '012FIXTURE00000001';
    private static final Id PERSON_RT = '012FIXTURE00000002';

    public static Id route(String kind) {
        return kind == 'business' ? BIZ_RT : PERSON_RT;
    }
}
