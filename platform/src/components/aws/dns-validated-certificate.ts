import { ComponentResourceOptions, Output, all } from "@pulumi/pulumi";
import { Component } from "../component";
import { Input } from "../input.js";
import { Dns } from "../dns";
import { acm } from "@pulumi/aws";

/**
 * Properties to create a DNS validated certificate managed by AWS Certificate Manager.
 */
export interface DnsValidatedCertificateArgs {
  /**
   * The fully qualified domain name in the certificate.
   */
  domainName: Input<string>;
  /**
   * Set of domains that should be SANs in the issued certificate
   */
  alternativeNames?: Input<string[]>;
  /**
   * The DNS adapter you want to use for managing DNS records.
   */
  dns: Input<Dns & {}>;
}

export class DnsValidatedCertificate extends Component {
  private certificateValidation:
    | acm.CertificateValidation
    | Output<acm.CertificateValidation>;

  constructor(
    name: string,
    args: DnsValidatedCertificateArgs,
    opts?: ComponentResourceOptions,
  ) {
    super(__pulumiType, name, args, opts);

    const parent = this;
    const { domainName, alternativeNames, dns } = args;

    const certificate = createCertificate();
    const records = createDnsRecords();
    this.certificateValidation = validateCertificate();

    function createCertificate() {
      return new acm.Certificate(
        `${name}Certificate`,
        {
          domainName,
          validationMethod: "DNS",
          subjectAlternativeNames: alternativeNames ?? [],
        },
        { parent },
      );
    }

    function createDnsRecords() {
      return all([dns, certificate.domainValidationOptions]).apply(
        ([dns, options]) =>
          options.map((option) =>
            dns.createRecord(
              name,
              {
                type: option.resourceRecordType,
                name: option.resourceRecordName,
                value: option.resourceRecordValue,
              },
              { parent },
            ),
          ),
      );
    }

    function validateCertificate() {
      return new acm.CertificateValidation(
        `${name}Validation`,
        {
          certificateArn: certificate.arn,
        },
        { parent, dependsOn: records },
      );
    }
  }

  public get arn() {
    return this.certificateValidation.certificateArn;
  }
}

const __pulumiType = "sst:aws:Certificate";
// @ts-expect-error
DnsValidatedCertificate.__pulumiType = __pulumiType;
