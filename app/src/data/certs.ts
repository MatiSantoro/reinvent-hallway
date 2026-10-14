// Map AWS certifications to catalog keywords.
// The API has no "certification" field, so we match these terms against each session's
// services, topics, areasOfInterest, title and abstract. Weights reflect exam domain focus.
//
// Exam versions checked against aws.amazon.com on 2026-10-13. The three that change right around
// re:Invent (Nov 30 - Dec 4, 2026) use the new version:
//   MLA-C02 (MLA-C01 retired Jan 14 2027), SAP-C03 (GA Nov 17 2026), DVA-C03 (GA Dec 1 2026).
// ANS-C01 is still current, but its last exam day is Dec 31 2026.

export interface CertProfile {
  id: string;
  /** Exam code shown to the user and sent to the planner, e.g. "MLA-C02". */
  code: string;
  name: string;
  /** term -> weight. Terms are matched case-insensitively as substrings. */
  terms: Record<string, number>;
}

export const CERTS: CertProfile[] = [
  {
    id: 'aip-c01',
    code: 'AIP-C01',
    name: 'Generative AI Developer - Professional',
    terms: {
      bedrock: 3, 'agentcore': 3, agent: 2, rag: 3, 'knowledge base': 2, guardrail: 2, 'prompt': 2,
      'generative ai': 2, embedding: 2, 'vector': 2, 'fine-tun': 2, opensearch: 1, sagemaker: 1, evaluation: 1,
    },
  },
  {
    id: 'aif-c01',
    code: 'AIF-C01',
    name: 'AI Practitioner',
    terms: { 'generative ai': 3, bedrock: 2, 'responsible ai': 3, 'machine learning': 2, 'amazon q': 2, sagemaker: 1 },
  },
  {
    id: 'mla-c02',
    code: 'MLA-C02',
    name: 'Machine Learning Engineer - Associate',
    terms: {
      sagemaker: 3, 'machine learning': 2, mlops: 3, training: 1, inference: 2, 'feature store': 2, pipeline: 1,
      'foundation model': 2, bedrock: 2, rag: 2, 'generative ai': 1, agentic: 1,
    },
  },
  {
    id: 'saa-c03',
    code: 'SAA-C03',
    name: 'Solutions Architect - Associate',
    terms: {
      architecture: 2, 'well-architected': 3, vpc: 2, 'high availability': 2, resilien: 2, s3: 1, ec2: 1,
      'elastic load': 1, rds: 1, dynamodb: 1, cost: 1,
    },
  },
  {
    id: 'sap-c03',
    code: 'SAP-C03',
    name: 'Solutions Architect - Professional',
    terms: {
      'multi-account': 3, migration: 3, 'control tower': 2, organizations: 2, 'transit gateway': 2,
      'disaster recovery': 3, hybrid: 2, modernization: 2, architecture: 1,
    },
  },
  {
    id: 'dva-c03',
    code: 'DVA-C03',
    name: 'Developer - Associate',
    terms: { lambda: 3, serverless: 3, 'api gateway': 2, dynamodb: 2, 'step functions': 2, sdk: 1, 'ci/cd': 2, cognito: 1 },
  },
  {
    id: 'soa-c03',
    code: 'SOA-C03',
    name: 'CloudOps Engineer - Associate',
    terms: { cloudwatch: 3, observability: 3, 'systems manager': 2, operations: 2, monitoring: 2, cloudformation: 1, backup: 1 },
  },
  {
    id: 'dop-c02',
    code: 'DOP-C02',
    name: 'DevOps Engineer - Professional',
    terms: { devops: 3, 'ci/cd': 3, codepipeline: 2, cloudformation: 2, cdk: 2, 'infrastructure as code': 3, observability: 1 },
  },
  {
    id: 'dea-c01',
    code: 'DEA-C01',
    name: 'Data Engineer - Associate',
    terms: { glue: 3, 'data lake': 3, redshift: 2, athena: 2, kinesis: 2, 'lake formation': 2, etl: 2, emr: 1 },
  },
  {
    id: 'scs-c03',
    code: 'SCS-C03',
    name: 'Security - Specialty',
    terms: { security: 2, iam: 3, kms: 2, 'guardduty': 2, 'security hub': 2, encryption: 2, 'zero trust': 2, compliance: 1 },
  },
  {
    id: 'ans-c01',
    code: 'ANS-C01',
    name: 'Advanced Networking - Specialty',
    terms: { networking: 3, vpc: 2, 'transit gateway': 3, 'direct connect': 3, 'route 53': 2, 'cloudfront': 1, ipv6: 2 },
  },
];

export const certById = (id: string) => CERTS.find((c) => c.id === id);

export const certLabel = (c: CertProfile) => `${c.code} · ${c.name}`;
