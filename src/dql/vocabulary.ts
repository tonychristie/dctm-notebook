export type DqlWordKind = 'keyword' | 'function' | 'constant';

export interface DqlCategory {
    scope: string;
    kind: DqlWordKind;
    words: readonly string[];
}

interface SourceGroup {
    scope: string;
    kind: DqlWordKind;
    phrases: string;
}

// The groups in the grammar's pattern order. A word belongs to the first group that names it.
const SOURCE_GROUPS: readonly SourceGroup[] = [
    {
        scope: 'keyword.control.dql',
        kind: 'keyword',
        phrases: 'SELECT FROM WHERE ORDER+BY GROUP+BY HAVING UNION INTERSECT MINUS ALL DISTINCT AS IN NOT+IN BETWEEN ' +
            'LIKE IS+NULL IS+NOT+NULL EXISTS AND OR NOT ASC DESC ENABLE WITH ANY SOME'
    },
    {
        scope: 'keyword.other.dml.dql',
        kind: 'keyword',
        phrases: 'INSERT INTO VALUES UPDATE SET DELETE APPEND REMOVE TRUNCATE MOVE LINK UNLINK CREATE ALTER DROP ' +
            'REGISTER UNREGISTER CHANGE GRANT REVOKE EXECUTE CHECKOUT CHECKIN LOCK UNLOCK QUEUE DEQUEUE BRANCH ' +
            'FREEZE UNFREEZE DESTROY PURGE'
    },
    {
        scope: 'keyword.other.object.dql',
        kind: 'keyword',
        phrases: 'OBJECT OBJECTS TYPE TYPES CABINET CABINETS FOLDER FOLDERS DOCUMENT DOCUMENTS ASSEMBLY ASSEMBLIES ' +
            'COMPONENT COMPONENTS RELATION RELATIONS ACL ACLS GROUP GROUPS USER USERS POLICY POLICIES ALIAS+SET ' +
            'METHOD PROCEDURE JOB WORKFLOW PROCESS ACTIVITY ROUTER WORKITEM INBOX LIFECYCLE STATE RENDITION FORMAT ' +
            'STORE LOCATION INDEX'
    },
    {
        scope: 'keyword.other.clause.dql',
        kind: 'keyword',
        phrases: 'INNER+JOIN LEFT+OUTER+JOIN RIGHT+OUTER+JOIN FULL+OUTER+JOIN CROSS+JOIN JOIN ON SEARCH FULLTEXT ' +
            'CONTAINS REPEATING FOR RETURN RETURN_TOP TOP FETCH+FIRST ROWS+ONLY OFFSET RELATE UNRELATE REGISTRATION ' +
            'FTINDEX VERITY COMPUTED'
    },
    {
        scope: 'keyword.other.search.dql',
        kind: 'keyword',
        phrases: 'SEARCH+DOCUMENT+CONTAINS FT_OPTIMIZER SCORE SUMMARY TOPIC ZONE NEAR PARAGRAPH SENTENCE SOUNDEX STEM ' +
            'THESAURUS WILDCARD ACCRUE CASE MANY ORDER PHRASE WORD YESNO'
    },
    {
        scope: 'storage.modifier.dql',
        kind: 'keyword',
        phrases: 'PUBLIC PRIVATE OWNER WORLD GROUP PERMIT BROWSE READ RELATE VERSION WRITE DELETE SYSADMIN SUPERUSER NONE'
    },
    {
        scope: 'keyword.other.transaction.dql',
        kind: 'keyword',
        phrases: 'BEGIN COMMIT ROLLBACK TRANSACTION SAVEPOINT'
    },
    {
        scope: 'keyword.other.options.dql',
        kind: 'keyword',
        phrases: 'NOCOMMIT NOWAIT WAIT FORCE CASCADE RESTRICT CONTINUE ABORT SKIP ALLOW DISALLOW OPTIONAL REQUIRED'
    },
    {
        scope: 'support.function.aggregate.dql',
        kind: 'function',
        phrases: 'COUNT SUM AVG MIN MAX FIRST LAST'
    },
    {
        scope: 'support.function.string.dql',
        kind: 'function',
        phrases: 'UPPER LOWER SUBSTR SUBSTRING LENGTH TRIM LTRIM RTRIM INSTR REPLACE CONCAT LPAD RPAD INITCAP REVERSE ' +
            'SPACE CHAR ASCII CHR POSITION TRANSLATE SOUNDEX CHARINDEX'
    },
    {
        scope: 'support.function.date.dql',
        kind: 'function',
        phrases: 'DATE DATEADD DATEDIFF DATEFLOOR DATETOSTRING DATETOSTRING_LOCAL TODAY NOW YEAR MONTH DAY HOUR MINUTE ' +
            'SECOND QUARTER WEEK DAYOFWEEK DAYOFYEAR CURRENT_DATE CURRENT_TIME CURRENT_TIMESTAMP GETDATE SYSDATE ' +
            'ADD_MONTHS MONTHS_BETWEEN LAST_DAY NEXT_DAY TRUNC ROUND EXTRACT'
    },
    {
        scope: 'support.function.conversion.dql',
        kind: 'function',
        phrases: 'CAST CONVERT TO_CHAR TO_DATE TO_NUMBER TO_INTEGER TO_DOUBLE TO_BOOLEAN ID FOLDER CABINET USER GROUP ' +
            'MFILE_URL MCONTENTS_URL OBJECT_NAME TYPE_NAME'
    },
    {
        scope: 'support.function.documentum.dql',
        kind: 'function',
        phrases: 'DOCUMENT GET_PATH GET_PERMIT GET_GROUP_PERMIT HAS_PERMIT CONTAINS ISCHILDOF ISPARENTOF DESCEND ' +
            'ANCESTORS DESCENDANTS PARENT CHILDREN SIBLINGS SUBTYPES ALL_SUBTYPES INHERITS EXTENDS DATEDIFF DATEPART ' +
            'DATESERIAL TIMESERIAL'
    },
    {
        scope: 'support.function.workflow.dql',
        kind: 'function',
        phrases: 'GET_WORKFLOW_ID GET_ACTIVITY_ID GET_ACTIVITY_NAME GET_PERFORMER GET_DUE_DATE GET_PRIORITY GET_PACKAGE ' +
            'IS_ACTIVE IS_RUNNING IS_PAUSED IS_HALTED IS_FINISHED IS_DORMANT GET_WORKITEM GET_QUEUE_ITEM'
    },
    {
        scope: 'support.function.permission.dql',
        kind: 'function',
        phrases: 'GET_PERMIT GET_GROUP_PERMIT HAS_PERMIT HAS_GROUP_PERMIT GET_PERMIT_NAME IS_SUPERUSER IS_SYSADMIN ' +
            'OWNER_NAME OWNER_PERMIT GROUP_NAME GROUP_PERMIT WORLD_PERMIT ACL_NAME ACL_DOMAIN GET_DEFAULT_ACL ' +
            'GET_FOLDER_PATH'
    },
    {
        scope: 'support.function.lifecycle.dql',
        kind: 'function',
        phrases: 'GET_STATE GET_STATE_NAME GET_POLICY_ID GET_POLICY_NAME GET_CURRENT_STATE GET_RESUME_STATE ' +
            'GET_ALIAS_VALUE GET_ALIAS_SET_ID IS_ATTACHED CAN_ATTACH CAN_DETACH CAN_PROMOTE CAN_DEMOTE CAN_SUSPEND ' +
            'CAN_RESUME'
    },
    {
        scope: 'support.function.retention.dql',
        kind: 'function',
        phrases: 'GET_RETENTION_DATE GET_HOLD_EXPIRATION IS_HOLD IS_FROZEN IS_IMMUTABLE GET_DISPOSITION_DATE ' +
            'GET_RULE_APPLIED_DATE'
    },
    {
        scope: 'support.function.fulltext.dql',
        kind: 'function',
        phrases: 'SCORE FTCONTAINS FTSEARCH FT_OPTIMIZER HIGHLIGHT SNIPPET'
    },
    {
        scope: 'support.function.math.dql',
        kind: 'function',
        phrases: 'ABS CEIL CEILING FLOOR ROUND TRUNCATE MOD POWER SQRT EXP LOG LOG10 LN SIGN GREATEST LEAST COALESCE ' +
            'NVL NULLIF DECODE IIF CASE WHEN THEN ELSE END'
    },
    {
        scope: 'support.function.system.dql',
        kind: 'function',
        phrases: 'SESSION_ID SERVER_NAME DOCBASE_NAME DOCBASE_ID USER_NAME USER_ID CLIENT_ID CLIENT_HOST DB_NAME ' +
            'DB_VERSION SERVER_VERSION DM_VERSION DATASPACE GET_SESSION'
    },
    {
        scope: 'support.function.virtual-document.dql',
        kind: 'function',
        phrases: 'GET_ASSEMBLY GET_COMPONENTS GET_BINDING_LABEL GET_BINDING_CONDITION GET_LATE_BINDING ' +
            'IS_VIRTUAL_DOCUMENT GET_SNAPSHOT_DATE GET_VERSION_LABEL'
    },
    {
        scope: 'constant.language.boolean.dql',
        kind: 'constant',
        phrases: 'TRUE FALSE'
    },
    {
        scope: 'constant.language.null.dql',
        kind: 'constant',
        phrases: 'NULL NULLDATE NULLSTRING NULLINT NULLID'
    },
    {
        scope: 'constant.language.special.dql',
        kind: 'constant',
        phrases: 'CURRENT ALL LATEST BRANCH'
    }
];

// Each word is listed under the category its colour has today, ahead of the pattern order.
const CATEGORY_OVERRIDES: Record<string, string> = {
    null: 'constant.language.null.dql',
    first: 'support.function.aggregate.dql'
};

// A multi-word phrase joins its words with +.
function wordsOf(phrases: string): string[] {
    return phrases.toLowerCase().split(' ').flatMap(phrase => phrase.split('+'));
}

function buildCategories(): DqlCategory[] {
    const owner = new Map<string, string>();
    for (const group of SOURCE_GROUPS) {
        for (const word of wordsOf(group.phrases)) {
            if (!owner.has(word)) {
                owner.set(word, CATEGORY_OVERRIDES[word] ?? group.scope);
            }
        }
    }
    return SOURCE_GROUPS.map(group => ({
        scope: group.scope,
        kind: group.kind,
        words: [...owner].filter(([, scope]) => scope === group.scope).map(([word]) => word)
    }));
}

export const DQL_CATEGORIES: readonly DqlCategory[] = buildCategories();

export const DQL_HINTS: readonly string[] = [
    'sql_def_result_set', 'ftindex', 'row_based', 'allow_leading_wildcard', 'force_order',
    'use_dm_fulltext_index', 'reparse'
];

export const DQL_SERVER_FUNCTIONS: ReadonlySet<string> = new Set([
    'count', 'sum', 'avg', 'min', 'max', 'upper', 'lower', 'substr', 'dateadd', 'datediff', 'datefloor',
    'datetostring', 'datetostring_local', 'id', 'mfile_url'
]);

const WORD_CATEGORY = new Map<string, DqlCategory>(
    DQL_CATEGORIES.flatMap(category => category.words.map(word => [word, category] as const))
);

export function dqlCategoryOf(word: string): DqlCategory | undefined {
    return WORD_CATEGORY.get(word.toLowerCase());
}

export function isDqlWord(word: string): boolean {
    return WORD_CATEGORY.has(word.toLowerCase());
}

export function dqlWordsOfKind(kind: DqlWordKind): string[] {
    return DQL_CATEGORIES.filter(category => category.kind === kind).flatMap(category => category.words);
}
