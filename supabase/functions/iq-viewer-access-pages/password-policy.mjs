// Keep sign-up and password reset guidance aligned with the configured policy.
export const passwordRequirements='Use at least 10 characters, including an uppercase letter, a lowercase letter and a number.';
export function passwordProblem(password){
 if(typeof password!=='string'||Array.from(password).length<10)return 'Your password must have at least 10 characters.';
 if(new TextEncoder().encode(password).length>72)return 'Your password is too long. Use no more than 72 bytes; some characters such as emoji use more than one byte.';
 const missing=[];
 if(!/[A-Z]/.test(password))missing.push('an uppercase letter');
 if(!/[a-z]/.test(password))missing.push('a lowercase letter');
 if(!/[0-9]/.test(password))missing.push('a number');
 return missing.length?'Add '+missing.join(', ').replace(/, ([^,]+)$/, ' and $1')+' to your password.':'';
}
export function passwordAuthError(error){
 if(error?.code!=='weak_password')return error;
 const reasons=Array.isArray(error.reasons)?error.reasons:Array.isArray(error.weak_password?.reasons)?error.weak_password.reasons:[];
 const message=reasons.includes('pwned')?'This password has appeared in a data breach. Choose a different, unique password.':'This password was rejected. '+passwordRequirements;
 return new Error(message);
}
