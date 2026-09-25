# Profile Asset Upload Proof Bucket

This AWS-only stack creates a dedicated, private S3 bucket for the local media upload proof. Its name is `vrdex-profile-assets-proof-${account_id}` in `us-east-1`. It uses separate remote state at `profile-assets-proof/terraform.tfstate` in `vrdex-terraform-state`.

The bucket blocks public access, enforces bucket ownership without ACLs, defaults to SSE-S3, and denies non-TLS requests. Its only lifecycle rule expires objects under `profile-assets/proof/local-upload/` after seven days. This stack has no application runtime role, CORS rule, Vercel settings, or access to the production profile asset bucket. CI formats and validates it but cannot plan or apply it.

## Local operation

Use the currently authenticated AWS credential chain, including the default chain if it is the approved identity for this bucket-scoped operation. A named profile is optional. From this directory in PowerShell, check the active identity immediately before planning:

```powershell
terraform init
terraform fmt -check
terraform validate
aws sts get-caller-identity --query '{Account:Account,Arn:Arn}' --output table
```

Confirm the reported account is the intended one and the expected bucket name is `vrdex-profile-assets-proof-${account_id}` for that account. Then plan and inspect the proposed changes:

```powershell
terraform plan -out=proof.tfplan
terraform show proof.tfplan
```

Confirm the planned bucket name matches the checked account. The plan must contain only `aws_s3_bucket.proof` and its five bucket settings (public access block, ownership controls, encryption, lifecycle, and TLS policy), with no changes to existing resources. After that review, check the identity again:

```powershell
aws sts get-caller-identity --query '{Account:Account,Arn:Arn}' --output table
```

Confirm the account remains the intended one before applying the saved plan:

```powershell
terraform apply proof.tfplan
terraform output -raw proof_bucket_name
```

The saved plan and `.terraform/` directory are local artifacts. Keep them out of git. Check identity and bucket name again before running the transfer proof, then confirm its generated keys are deleted as described in [local media upload verification](../../../docs/testing/local-media-upload.md). The seven-day lifecycle rule is a fallback for orphaned proof objects, not a substitute for the script's immediate cleanup.
